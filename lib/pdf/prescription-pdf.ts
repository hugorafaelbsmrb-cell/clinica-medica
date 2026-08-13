/**
 * Gera o PDF de uma prescrição médica (PDFKit).
 * Usado no envio automático via WhatsApp e pode ser reutilizado
 * para download/impressão no futuro.
 */
import PDFDocument from "pdfkit"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import type { ClinicInfo } from "@/lib/clinic"
import { drawClinicHeader, drawSignatureBlock } from "./shared"

export type PrescriptionPdfData = {
  patientName: string
  patientBirthDate?: Date | null
  patientPhone?: string | null
  patientCpf?: string | null
  doctorName?: string | null
  doctorCrm?: string | null
  doctorSignature?: string | null
  clinic?: ClinicInfo
  issuedAt: Date
  items: Array<{
    medication: string
    dosage?: string | null
    frequency?: string | null
    duration?: string | null
    instructions?: string | null
  }>
}

export async function generatePrescriptionPdf(
  data: PrescriptionPdfData
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 56, bottom: 56, left: 56, right: 56 },
    info: { Title: `Prescrição — ${data.patientName}` },
  })

  const chunks: Buffer[] = []
  doc.on("data", (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks)))
  )

  // Cabeçalho da clínica + data de emissão
  drawClinicHeader(doc, data.clinic, "Prescrição Médica")
  doc.fontSize(9).font("Helvetica").fillColor("#555555")
  doc.text(
    `Emitida em ${format(data.issuedAt, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`,
    { align: "right" }
  )
  doc.fillColor("#000000")
  doc.moveDown(1.2)

  // Dados do paciente
  doc.fontSize(11).font("Helvetica-Bold").text("Paciente")
  doc.moveDown(0.4)
  doc.fontSize(12).font("Helvetica").text(data.patientName)
  doc.fontSize(10).fillColor("#555555")
  if (data.patientBirthDate) {
    doc.text(
      `Nascimento: ${format(data.patientBirthDate, "dd/MM/yyyy", { locale: ptBR })}`
    )
  }
  if (data.patientPhone) doc.text(`Telefone: ${data.patientPhone}`)
  if (data.patientCpf) doc.text(`CPF: ${data.patientCpf}`)
  doc.fillColor("#000000")
  doc.moveDown(1.2)

  // Medicamentos
  doc.fontSize(11).font("Helvetica-Bold").text("Medicamentos")
  doc.moveDown(0.4)

  const colX = doc.page.margins.left
  const tableTop = doc.y
  const colWidths = [150, 70, 90, 80, 130] // medicamento, dose, frequência, duração, orientações
  const headers = ["Medicamento", "Dose", "Frequência", "Duração", "Orientações"]

  doc.fontSize(9).font("Helvetica-Bold").fillColor("#444444")
  let x = colX
  headers.forEach((header, i) => {
    doc.text(header, x, tableTop, { width: colWidths[i] })
    x += colWidths[i]
  })
  doc.y += 16
  doc.fillColor("#000000").font("Helvetica")

  data.items.forEach((item) => {
    const row = [
      item.medication,
      item.dosage ?? "—",
      item.frequency ?? "—",
      item.duration ?? "—",
      item.instructions ?? "—",
    ]
    const rowHeight = Math.max(
      16,
      ...row.map((value) =>
        doc.heightOfString(value, { width: colWidths[row.indexOf(value)] })
      )
    )

    // Quebra de página se não couber
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 80) {
      doc.addPage()
    }

    const rowTop = doc.y
    let cx = colX
    row.forEach((value, i) => {
      doc.fontSize(9).font(i === 0 ? "Helvetica-Bold" : "Helvetica")
      doc.text(value, cx, rowTop, { width: colWidths[i] - 8 })
      cx += colWidths[i]
    })
    doc.y = rowTop + rowHeight + 4
    doc.moveTo(colX, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .strokeColor("#dddddd")
      .stroke()
    doc.moveDown(0.3)
  })

  // Assinatura do médico (pré-cadastrada + CRM)
  drawSignatureBlock(doc, {
    signatureText: data.doctorSignature ?? data.doctorName,
    doctorName: data.doctorName,
    crm: data.doctorCrm,
  })

  doc.end()
  return done
}
