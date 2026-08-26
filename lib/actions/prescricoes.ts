"use server"

import { revalidatePath } from "next/cache"
import { format } from "date-fns"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { getClinicSettings } from "@/lib/clinic"
import { resolveDoctorId } from "@/lib/doctor"
import { generatePrescriptionPdf } from "@/lib/pdf/prescription-pdf"
import { signPdfIfEnabled } from "@/lib/signing/certificate"
import { sendDocumentMessage } from "@/lib/whatsapp/message-service"

export type ActionState = {
  success: boolean
  message: string
  prescriptionId?: string
}

/**
 * Cria prescrição com múltiplos medicamentos.
 * Os campos medication/dosage/frequency/duration/instructions chegam como
 * arrays (mesmos nomes repetidos no formulário).
 */
export async function createPrescription(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }

  const patientId = formData.get("patientId")?.toString() ?? ""
  const attendanceId = formData.get("attendanceId")?.toString() || null

  const medications = formData.getAll("medication").map(String)
  const dosages = formData.getAll("dosage").map(String)
  const frequencies = formData.getAll("frequency").map(String)
  const durations = formData.getAll("duration").map(String)
  const instructions = formData.getAll("instructions").map(String)

  const validItems = medications.filter((m) => m.trim().length > 0)
  const schema = z.object({
    patientId: z.string().min(1, "Selecione o paciente"),
    items: z
      .array(z.string().min(2, "Nome do medicamento muito curto"))
      .min(1, "Adicione pelo menos um medicamento"),
  })

  const parsed = schema.safeParse({ patientId, items: validItems })
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }

  // Médico responsável: o médico assina sempre com o próprio usuário;
  // admin/secretária escolhem o médico cadastrado no formulário.
  const doctorResult = await resolveDoctorId({
    role: session.user.role,
    selfId: session.user.id,
    doctorId: formData.get("doctorId")?.toString() || null,
    required: true,
  })
  if (doctorResult.error) {
    return { success: false, message: doctorResult.error }
  }

  const prescription = await prisma.prescription.create({
    data: {
      patientId,
      attendanceId,
      doctorId: doctorResult.doctorId,
      items: {
        create: validItems.map((medication, index) => ({
          medication: medication.trim(),
          dosage: dosages[index]?.trim() || null,
          frequency: frequencies[index]?.trim() || null,
          duration: durations[index]?.trim() || null,
          instructions: instructions[index]?.trim() || null,
        })),
      },
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CREATE",
      entity: "Prescription",
      entityId: prescription.id,
      patientId,
    },
  })

  // Envio automático do PDF por WhatsApp quando o paciente permite
  const full = await prisma.prescription.findUnique({
    where: { id: prescription.id },
    include: { patient: true, doctor: true, items: true },
  })

  let whatsappNote = ""
  if (full?.patient) {
    const patient = full.patient
    if (patient.phone && patient.whatsappEnabled && patient.lgpdConsent) {
      try {
        const clinic = await getClinicSettings()
        const generated = await generatePrescriptionPdf({
          patientName: patient.name,
          patientBirthDate: patient.birthDate,
          patientPhone: patient.phone,
          patientCpf: patient.cpf,
          doctorName: full.doctor?.name,
          doctorCrm: full.doctor?.crm,
          doctorSignature: full.doctor?.signatureText,
          signatureImage: full.doctor?.signatureImage,
          clinic,
          issuedAt: prescription.createdAt,
          items: full.items,
        })
        // Assinatura digital ICP-Brasil (PAdES) quando habilitada e com certificado válido
        const { signed, pdf } = await signPdfIfEnabled({
          doctorId: full.doctorId,
          doctorName: full.doctor?.name,
          documentType: "Prescription",
          documentId: prescription.id,
          patientId,
          actorId: session.user.id,
          pdf: generated,
        })
        const sent = await sendDocumentMessage(
          patientId,
          `Olá ${patient.name.split(" ")[0]}! Segue sua prescrição médica em PDF. Qualquer dúvida, estamos à disposição.`,
          pdf,
          `prescricao-${format(new Date(), "dd-MM-yyyy")}.pdf`
        )
        whatsappNote = sent.ok
          ? ` e enviada por WhatsApp${signed ? " com assinatura digital" : ""}`
          : ` (WhatsApp: ${sent.message})`
      } catch (error) {
        console.error("[Prescrição] Falha ao enviar PDF por WhatsApp:", error)
        whatsappNote = " (falha ao enviar PDF por WhatsApp)"
      }
    } else if (!patient.phone) {
      whatsappNote = " (paciente sem telefone cadastrado)"
    } else if (!patient.whatsappEnabled || !patient.lgpdConsent) {
      whatsappNote = " (paciente sem WhatsApp/LGPD habilitados)"
    }
  }

  revalidatePath("/prescricoes")
  return {
    success: true,
    message: `Prescrição criada${whatsappNote}`,
    prescriptionId: prescription.id,
  }
}
