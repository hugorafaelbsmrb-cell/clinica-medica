/**
 * Reenvia a prescrição da Sebastiana usando o caminho real de produção:
 * generatePrescriptionPdf → signPdfIfEnabled → sendDocumentMessage.
 * Uso: $env:DATABASE_URL='...6543...?pgbouncer=true'; npx tsx scripts/resend-prescricao.ts
 */
import { PrismaClient } from "@prisma/client"
import { format } from "date-fns"
import { generatePrescriptionPdf } from "../lib/pdf/prescription-pdf"
import { signPdfIfEnabled } from "../lib/signing/certificate"
import { sendDocumentMessage } from "../lib/whatsapp/message-service"
import { getClinicSettings } from "../lib/clinic"

const p = new PrismaClient()

async function main() {
  const rx = await p.prescription.findFirst({
    where: { patientId: "cmtk9ifyu0028pa0j73ysw98m" },
    orderBy: { createdAt: "desc" },
    include: { patient: true, doctor: true, items: true },
  })
  if (!rx) throw new Error("Prescrição não encontrada")

  const clinic = await getClinicSettings()
  const generated = await generatePrescriptionPdf({
    patientName: rx.patient.name,
    patientBirthDate: rx.patient.birthDate,
    patientPhone: rx.patient.phone,
    patientCpf: rx.patient.cpf,
    doctorName: rx.doctor?.name,
    doctorCrm: rx.doctor?.crm,
    doctorSignature: rx.doctor?.signatureText,
    signatureImage: rx.doctor?.signatureImage,
    clinic,
    issuedAt: rx.createdAt,
    items: rx.items,
  })

  const { signed, pdf } = await signPdfIfEnabled({
    doctorId: rx.doctorId,
    doctorName: rx.doctor?.name,
    documentType: "Prescription",
    documentId: rx.id,
    patientId: rx.patientId,
    actorId: rx.doctorId,
    pdf: generated,
  })

  const sent = await sendDocumentMessage(
    rx.patientId,
    `Olá ${rx.patient.name.split(" ")[0]}! Segue sua prescrição médica em PDF. Qualquer dúvida, estamos à disposição.`,
    pdf,
    `prescricao-${format(rx.createdAt, "dd-MM-yyyy")}.pdf`
  )
  console.log(
    sent.ok
      ? `✓ Prescrição reenviada para ${rx.patient.phone}${signed ? " (com assinatura digital)" : ""}`
      : `✗ Falha: ${sent.message}`
  )
}

main()
  .then(() => p.$disconnect())
  .catch((err) => {
    console.error(err)
    p.$disconnect()
    process.exit(1)
  })
