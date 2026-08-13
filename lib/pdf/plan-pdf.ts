/**
 * Gera o PDF do plano terapêutico (PDFKit) para envio ao paciente.
 */
import PDFDocument from "pdfkit"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import type { ClinicInfo } from "@/lib/clinic"
import { drawClinicHeader, drawSignatureBlock } from "./shared"

export type PlanPdfData = {
  patientName: string
  doctorName?: string | null
  doctorCrm?: string | null
  doctorSignature?: string | null
  clinic?: ClinicInfo
  updatedAt: Date
  diagnosis: string
  goals?: string | null
  guidelines?: string | null
  summary?: string | null
}

function addSection(
  doc: PDFKit.PDFDocument,
  title: string,
  content: string | null | undefined
): void {
  doc.fontSize(11).font("Helvetica-Bold").text(title)
  doc.moveDown(0.4)
  doc.fontSize(10).font("Helvetica").fillColor("#333333")
  doc.text(content?.trim() || "—")
  doc.fillColor("#000000")
  doc.moveDown(1)
}

export async function generatePlanPdf(data: PlanPdfData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 56, bottom: 56, left: 56, right: 56 },
    info: { Title: `Plano terapêutico — ${data.patientName}` },
  })

  const chunks: Buffer[] = []
  doc.on("data", (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks)))
  )

  // Cabeçalho da clínica + data de atualização
  drawClinicHeader(doc, data.clinic, "Plano Terapêutico")
  doc.fontSize(9).font("Helvetica").fillColor("#555555")
  doc.text(
    `Atualizado em ${format(data.updatedAt, "dd/MM/yyyy", { locale: ptBR })}`,
    { align: "right" }
  )
  doc.fillColor("#000000")
  doc.moveDown(1.2)

  doc.fontSize(13).font("Helvetica-Bold").text(data.patientName)
  doc.moveDown(1)

  addSection(doc, "Diagnóstico", data.diagnosis)
  addSection(doc, "Metas do tratamento", data.goals)
  addSection(doc, "Orientações e condutas", data.guidelines)

  if (data.summary) {
    doc.moveDown(0.4)
    doc.fontSize(11).font("Helvetica-Bold").text("Resumo do plano")
    doc.moveDown(0.4)
    doc.fontSize(10).font("Helvetica").fillColor("#333333")
    doc.text(data.summary)
    doc.fillColor("#000000")
  }

  // Assinatura do médico (pré-cadastrada + CRM)
  drawSignatureBlock(doc, {
    signatureText: data.doctorSignature ?? data.doctorName,
    doctorName: data.doctorName,
    crm: data.doctorCrm,
  })

  doc.end()
  return done
}
