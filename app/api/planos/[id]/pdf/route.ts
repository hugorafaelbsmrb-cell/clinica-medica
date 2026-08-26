import { NextResponse } from "next/server"
import { format } from "date-fns"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getClinicSettings } from "@/lib/clinic"
import { generatePlanPdf } from "@/lib/pdf/plan-pdf"
import { signPdfIfEnabled } from "@/lib/signing/certificate"

export const dynamic = "force-dynamic"

/**
 * Download do PDF do plano terapêutico (com assinatura digital
 * ICP-Brasil quando habilitada e o médico tiver certificado válido).
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
  const plan = await prisma.therapeuticPlan.findUnique({
    where: { id },
    include: { patient: true, doctor: true },
  })
  if (!plan) {
    return NextResponse.json({ error: "Plano não encontrado" }, { status: 404 })
  }

  const clinic = await getClinicSettings()
  const generated = await generatePlanPdf({
    patientName: plan.patient.name,
    doctorName: plan.doctor?.name,
    doctorCrm: plan.doctor?.crm,
    doctorSignature: plan.doctor?.signatureText,
    signatureImage: plan.doctor?.signatureImage,
    clinic,
    updatedAt: plan.updatedAt,
    diagnosis: plan.diagnosis,
    goals: plan.goals,
    guidelines: plan.guidelines,
    summary: plan.summary,
  })

  const { signed, pdf } = await signPdfIfEnabled({
    doctorId: plan.doctorId,
    doctorName: plan.doctor?.name,
    documentType: "TherapeuticPlan",
    documentId: plan.id,
    patientId: plan.patientId,
    actorId: session.user.id,
    pdf: generated,
  })

  const filename = `plano-terapeutico-${format(plan.updatedAt, "dd-MM-yyyy")}${signed ? "-assinado" : ""}.pdf`
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
