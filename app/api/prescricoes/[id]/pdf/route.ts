import { NextResponse } from "next/server"
import { format } from "date-fns"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getClinicSettings } from "@/lib/clinic"
import { generatePrescriptionPdf } from "@/lib/pdf/prescription-pdf"
import { signPdfIfEnabled } from "@/lib/signing/certificate"

export const dynamic = "force-dynamic"

/**
 * Download do PDF da prescrição (com assinatura digital ICP-Brasil
 * quando habilitada e o médico tiver certificado válido).
 * Protegida por sessão (ADMIN, MEDICO).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }
  if (!["ADMIN", "MEDICO"].includes(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 })
  }

  const { id } = await params
  const prescription = await prisma.prescription.findUnique({
    where: { id },
    include: { patient: true, doctor: true, items: true },
  })
  if (!prescription) {
    return NextResponse.json({ error: "Prescrição não encontrada" }, { status: 404 })
  }

  const clinic = await getClinicSettings()
  const generated = await generatePrescriptionPdf({
    patientName: prescription.patient.name,
    patientBirthDate: prescription.patient.birthDate,
    patientPhone: prescription.patient.phone,
    patientCpf: prescription.patient.cpf,
    doctorName: prescription.doctor?.name,
    doctorCrm: prescription.doctor?.crm,
    doctorSignature: prescription.doctor?.signatureText,
    signatureImage: prescription.doctor?.signatureImage,
    clinic,
    issuedAt: prescription.createdAt,
    items: prescription.items,
  })

  const { signed, pdf } = await signPdfIfEnabled({
    doctorId: prescription.doctorId,
    doctorName: prescription.doctor?.name,
    documentType: "Prescription",
    documentId: prescription.id,
    patientId: prescription.patientId,
    patientName: prescription.patient.name,
    actorId: session.user.id,
    pdf: generated,
  })

  const filename = `prescricao-${format(prescription.createdAt, "dd-MM-yyyy")}${signed ? "-assinada" : ""}.pdf`
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
