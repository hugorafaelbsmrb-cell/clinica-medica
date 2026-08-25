/**
 * Elementos compartilhados dos PDFs: cabeçalho da clínica (logo + contato)
 * e bloco de assinatura do médico (assinatura pré-cadastrada + CRM).
 */
import type PDFDocument from "pdfkit"
import type { ClinicInfo } from "@/lib/clinic"

/** Converte a logo (data URL) em Buffer para o pdfkit; null se ausente/inválida. */
export function parseLogoBuffer(dataUrl?: string | null): Buffer | null {
  if (!dataUrl) return null
  const match = /^data:image\/(png|jpe?g);base64,([\s\S]+)$/.exec(dataUrl)
  if (!match) return null
  try {
    return Buffer.from(match[2], "base64")
  } catch {
    return null
  }
}

/**
 * Desenha o cabeçalho da clínica: logo à esquerda, nome + contato à direita,
 * título do documento e linha divisória.
 */
export function drawClinicHeader(
  doc: PDFKit.PDFDocument,
  clinic: ClinicInfo | undefined,
  docTitle: string
): void {
  const left = doc.page.margins.left
  const top = doc.page.margins.top
  const right = doc.page.width - doc.page.margins.right

  const logo = parseLogoBuffer(clinic?.logoDataUrl)
  const name = clinic?.name || "Médico em Domicílio"

  if (logo) {
    doc.image(logo, left, top, { fit: [110, 46] })
  }

  const textX = left + (logo ? 122 : 0)
  doc.fontSize(15).font("Helvetica-Bold").fillColor("#111111")
  doc.text(name, textX, top, { width: right - textX })

  const contactParts = [clinic?.address, clinic?.phone, clinic?.email].filter(
    (part): part is string => Boolean(part?.trim())
  )
  let y = doc.y + 2
  if (contactParts.length > 0) {
    doc.fontSize(8.5).font("Helvetica").fillColor("#555555")
    doc.text(contactParts.join("  •  "), textX, y, { width: right - textX })
    y = doc.y
  }

  doc.fontSize(12).font("Helvetica-Bold").fillColor("#333333")
  doc.text(docTitle, left, y + 6)
  doc.fillColor("#000000")

  const lineY = doc.y + 6
  doc.moveTo(left, lineY)
    .lineTo(right, lineY)
    .strokeColor("#999999")
    .stroke()
  doc.y = lineY + 14
}

/**
 * Desenha o bloco de assinatura: linha de assinatura, assinatura pré-cadastrada
 * em itálico (se houver), nome do médico e CRM.
 */
export function drawSignatureBlock(
  doc: PDFKit.PDFDocument,
  options: {
    signatureText?: string | null
    doctorName?: string | null
    crm?: string | null
    label?: string
  }
): void {
  const left = doc.page.margins.left
  doc.moveDown(2)

  const lineY = doc.y
  doc.moveTo(left, lineY)
    .lineTo(left + 220, lineY)
    .strokeColor("#999999")
    .stroke()

  if (options.signatureText?.trim()) {
    doc.fontSize(13)
      .font("Helvetica-Oblique")
      .fillColor("#111111")
      .text(options.signatureText.trim(), left, lineY - 18, { width: 220 })
  }

  doc.fontSize(9).font("Helvetica").fillColor("#555555")
  doc.text(options.label ?? "Assinatura do médico", left, lineY + 6)

  if (options.doctorName?.trim()) {
    doc.fontSize(10)
      .font("Helvetica-Bold")
      .fillColor("#000000")
      .text(options.doctorName.trim(), left, doc.y + 2)
  }
  if (options.crm?.trim()) {
    doc.fontSize(9)
      .font("Helvetica")
      .fillColor("#555555")
      .text(options.crm.trim(), left, doc.y + 1)
  }
  doc.fillColor("#000000")
}
