"use server"

import { revalidatePath } from "next/cache"
import { format } from "date-fns"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { getClinicSettings } from "@/lib/clinic"
import { resolveDoctorId } from "@/lib/doctor"
import { generatePlanSummary } from "@/lib/ai/therapeutic-plan"
import { isAIEnabled } from "@/lib/ai/provider"
import { generatePlanPdf } from "@/lib/pdf/plan-pdf"
import { sendDocumentMessage } from "@/lib/whatsapp/message-service"

export type ActionState = {
  success: boolean
  message: string
  planId?: string
  /** Conteúdo do resumo gerado pela pré-visualização com IA */
  content?: string
}

const planSchema = z.object({
  patientId: z.string().min(1, "Selecione o paciente"),
  diagnosis: z.string().min(3, "Informe o diagnóstico"),
  goals: z.string().optional().nullable(),
  guidelines: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  source: z.enum(["IA", "MANUAL"]).optional(),
})

export async function createPlan(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }

  const parsed = planSchema.safeParse({
    patientId: formData.get("patientId"),
    diagnosis: formData.get("diagnosis"),
    goals: formData.get("goals") || null,
    guidelines: formData.get("guidelines") || null,
    summary: formData.get("summary") || null,
    source: formData.get("source"),
  })

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

  const data = parsed.data
  const plan = await prisma.therapeuticPlan.create({
    data: {
      patientId: data.patientId,
      doctorId: doctorResult.doctorId,
      diagnosis: data.diagnosis,
      goals: data.goals || null,
      guidelines: data.guidelines || null,
      summary: data.summary || null,
      source: data.source === "IA" ? "IA" : "MANUAL",
      status: data.summary ? "APROVADO" : "RASCUNHO",
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CREATE",
      entity: "TherapeuticPlan",
      entityId: plan.id,
      patientId: data.patientId,
    },
  })

  revalidatePath("/planos-terapeuticos")
  return { success: true, message: "Plano terapêutico criado", planId: plan.id }
}

export async function updatePlan(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }

  const id = formData.get("id")?.toString() ?? ""
  const parsed = planSchema.safeParse({
    patientId: formData.get("patientId"),
    diagnosis: formData.get("diagnosis"),
    goals: formData.get("goals") || null,
    guidelines: formData.get("guidelines") || null,
    summary: formData.get("summary") || null,
    source: formData.get("source"),
  })

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }

  const data = parsed.data
  const plan = await prisma.therapeuticPlan.update({
    where: { id },
    data: {
      diagnosis: data.diagnosis,
      goals: data.goals || null,
      guidelines: data.guidelines || null,
      summary: data.summary || null,
      source: data.source === "IA" ? "IA" : "MANUAL",
      status: data.summary ? "APROVADO" : "RASCUNHO",
    },
  })

  revalidatePath("/planos-terapeuticos")
  revalidatePath(`/planos-terapeuticos/${plan.id}`)
  return { success: true, message: "Plano atualizado", planId: plan.id }
}

/**
 * Aprova o plano (status APROVADO). Exige que haja um resumo preenchido.
 */
export async function approvePlan(planId: string): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }

  const plan = await prisma.therapeuticPlan.findUnique({
    where: { id: planId },
    include: { patient: true, doctor: true },
  })
  if (!plan) return { success: false, message: "Plano não encontrado" }
  if (!plan.summary) {
    return {
      success: false,
      message: "Preencha ou gere o resumo antes de aprovar o plano",
    }
  }

  await prisma.therapeuticPlan.update({
    where: { id: planId },
    data: { status: "APROVADO" },
  })

  // Envio automático do PDF por WhatsApp quando o paciente permite
  let whatsappNote = ""
  if (
    plan.patient.phone &&
    plan.patient.whatsappEnabled &&
    plan.patient.lgpdConsent
  ) {
    try {
      const clinic = await getClinicSettings()
      const pdf = await generatePlanPdf({
        patientName: plan.patient.name,
        doctorName: plan.doctor?.name,
        doctorCrm: plan.doctor?.crm,
        doctorSignature: plan.doctor?.signatureText,
        signatureImage: plan.doctor?.signatureImage,
        clinic,
        updatedAt: new Date(),
        diagnosis: plan.diagnosis,
        goals: plan.goals,
        guidelines: plan.guidelines,
        summary: plan.summary,
      })
      const sent = await sendDocumentMessage(
        plan.patientId,
        `Olá ${plan.patient.name.split(" ")[0]}! 💙 Seu plano terapêutico foi finalizado. Aqui está o seu resumo:\n\n${plan.summary}\n\n📄 O plano completo segue no PDF anexo. Qualquer dúvida, fale com a clínica. 😊`,
        pdf,
        `plano-terapeutico-${format(new Date(), "dd-MM-yyyy")}.pdf`
      )
      whatsappNote = sent.ok
        ? " e enviado por WhatsApp"
        : ` (WhatsApp: ${sent.message})`
    } catch (error) {
      console.error("[Plano] Falha ao enviar PDF por WhatsApp:", error)
      whatsappNote = " (falha ao enviar PDF por WhatsApp)"
    }
  } else if (!plan.patient.phone) {
    whatsappNote = " (paciente sem telefone cadastrado)"
  } else if (!plan.patient.whatsappEnabled || !plan.patient.lgpdConsent) {
    whatsappNote = " (paciente sem WhatsApp/LGPD habilitados)"
  }

  revalidatePath(`/planos-terapeuticos/${planId}`)
  return { success: true, message: `Plano aprovado${whatsappNote}`, planId }
}

/**
 * Gera um resumo com IA a partir dos campos do formulário, sem salvar o plano.
 * Inclui as prescrições já cadastradas do paciente, quando existirem.
 * Sem chave da DeepSeek, retorna erro amigável e o fluxo manual continua.
 */
export async function previewSummaryWithAI(input: {
  patientId?: string | null
  diagnosis: string
  goals?: string | null
  guidelines?: string | null
}): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }

  if (!(await isAIEnabled())) {
    return {
      success: false,
      message:
        "IA não configurada. Adicione a chave da DeepSeek em Configurações ou escreva o resumo manualmente.",
    }
  }

  if (!input.diagnosis || input.diagnosis.trim().length < 3) {
    return {
      success: false,
      message: "Informe o diagnóstico antes de gerar o resumo",
    }
  }

  let patientName = "Paciente"
  const prescriptions: string[] = []

  if (input.patientId) {
    const patient = await prisma.patient.findUnique({
      where: { id: input.patientId },
      include: { prescriptions: { include: { items: true } } },
    })
    if (patient) {
      patientName = patient.name
      prescriptions.push(
        ...patient.prescriptions.flatMap((prescription) =>
          prescription.items.map((item) =>
            [item.medication, item.dosage, item.frequency, item.duration]
              .filter(Boolean)
              .join(" — ")
          )
        )
      )
    }
  }

  const result = await generatePlanSummary({
    patientName,
    diagnosis: input.diagnosis,
    goals: input.goals,
    guidelines: input.guidelines,
    prescriptions,
  })

  if (!result.ok || !result.content) {
    return { success: false, message: result.error ?? "Falha na geração com IA" }
  }

  return {
    success: true,
    message: "Resumo gerado com IA — revise antes de salvar",
    content: result.content,
  }
}
