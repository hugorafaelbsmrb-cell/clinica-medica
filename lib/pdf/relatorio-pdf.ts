/**
 * Gera o PDF do relatório financeiro (PDFKit).
 *
 * Layout: cabeçalho da clínica (logo + contato, via drawClinicHeader),
 * período e data de geração, resumo do período (receita paga, a receber,
 * despesas e saldo) e a tabela de lançamentos com quebra de página.
 */
import PDFDocument from "pdfkit"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import type { ClinicInfo } from "@/lib/clinic"
import { drawClinicHeader } from "./shared"

export type FinancialReportEntry = {
  dueDate: Date
  type: "RECEITA" | "DESPESA"
  category: string
  description: string
  value: number
  status: "PAGO" | "PENDENTE"
}

export type FinancialReportPdfData = {
  clinic?: ClinicInfo
  from: Date
  to: Date
  generatedAt: Date
  receitaPaga: number
  aReceber: number
  despesas: number
  entries: FinancialReportEntry[]
}

const CATEGORY_LABELS: Record<string, string> = {
  CONSULTA_PRESENCIAL: "Consulta presencial",
  CONSULTA_DOMICILIAR: "Consulta domiciliar",
  TELECONSULTA: "Teleconsulta",
  ACOMPANHAMENTO: "Acompanhamento",
  PROCEDIMENTO: "Procedimento",
  MEDICAMENTO: "Medicamento",
  OPERACIONAL: "Operacional",
  OUTRO: "Outro",
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value)
}

const COL_WIDTHS = [58, 48, 82, 160, 72, 63] // vencimento, tipo, categoria, descrição, valor, status

/** Desenha a linha de título da tabela de lançamentos. */
function drawTableHeader(doc: PDFKit.PDFDocument): void {
  const left = doc.page.margins.left
  const top = doc.y
  const headers = ["Vencimento", "Tipo", "Categoria", "Descrição", "Valor", "Status"]
  doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#444444")
  let x = left
  headers.forEach((header, i) => {
    const isRight = i >= 4
    doc.text(header, x, top, {
      width: COL_WIDTHS[i],
      align: isRight ? "right" : "left",
    })
    x += COL_WIDTHS[i]
  })
  doc.moveTo(left, doc.y + 4)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y + 4)
    .strokeColor("#999999")
    .stroke()
  doc.y += 8
  doc.fillColor("#000000").font("Helvetica")
}

/** Caixinha do resumo: rótulo pequeno + valor em destaque. */
function drawSummaryBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
  valueColor: string
): void {
  doc.roundedRect(x, y, width, 44, 4).fillAndStroke("#f3f4f6", "#e5e7eb")
  doc.fontSize(8).font("Helvetica").fillColor("#555555")
  doc.text(label, x + 8, y + 7, { width: width - 16 })
  doc.fontSize(13).font("Helvetica-Bold").fillColor(valueColor)
  doc.text(value, x + 8, y + 23, { width: width - 16 })
  doc.fillColor("#000000").font("Helvetica")
}

export async function generateFinancialReportPdf(
  data: FinancialReportPdfData
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 56, bottom: 56, left: 56, right: 56 },
    info: { Title: "Relatório Financeiro" },
  })

  const chunks: Buffer[] = []
  doc.on("data", (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks)))
  )

  const left = doc.page.margins.left
  const right = doc.page.width - doc.page.margins.right
  const usable = right - left

  // Cabeçalho da clínica (logo + contato) + período
  drawClinicHeader(doc, data.clinic, "Relatório Financeiro")
  const periodY = doc.y
  doc.fontSize(9).font("Helvetica").fillColor("#555555")
  doc.text(
    `Período: ${format(data.from, "dd/MM/yyyy", { locale: ptBR })} até ${format(data.to, "dd/MM/yyyy", { locale: ptBR })}`,
    left,
    periodY,
    { width: usable / 2, align: "left" }
  )
  doc.text(
    `Gerado em ${format(data.generatedAt, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`,
    left + usable / 2,
    periodY,
    { width: usable / 2, align: "right" }
  )
  doc.fillColor("#000000")
  doc.y = periodY + 11
  doc.moveDown(1.4)

  // Resumo do período
  const saldo = data.receitaPaga - data.despesas
  const gap = 8
  const boxWidth = (usable - gap * 3) / 4
  const boxesY = doc.y
  drawSummaryBox(
    doc,
    left,
    boxesY,
    boxWidth,
    "Receita paga",
    formatCurrency(data.receitaPaga),
    "#047857"
  )
  drawSummaryBox(
    doc,
    left + boxWidth + gap,
    boxesY,
    boxWidth,
    "A receber",
    formatCurrency(data.aReceber),
    "#b45309"
  )
  drawSummaryBox(
    doc,
    left + (boxWidth + gap) * 2,
    boxesY,
    boxWidth,
    "Despesas",
    formatCurrency(data.despesas),
    "#b91c1c"
  )
  drawSummaryBox(
    doc,
    left + (boxWidth + gap) * 3,
    boxesY,
    boxWidth,
    "Saldo do período",
    formatCurrency(saldo),
    saldo >= 0 ? "#1d4ed8" : "#b91c1c"
  )
  doc.y = boxesY + 44 + 14

  // Tabela de lançamentos
  doc.fontSize(11).font("Helvetica-Bold").fillColor("#333333")
  doc.text("Lançamentos")
  doc.fillColor("#000000")
  doc.moveDown(0.5)

  if (data.entries.length === 0) {
    doc.fontSize(9).font("Helvetica").fillColor("#555555")
    doc.text("Nenhum lançamento financeiro no período.")
    doc.fillColor("#000000")
  } else {
    drawTableHeader(doc)

    data.entries.forEach((entry, index) => {
      const isExpense = entry.type === "DESPESA"
      const cells = [
        format(entry.dueDate, "dd/MM/yyyy", { locale: ptBR }),
        isExpense ? "Despesa" : "Receita",
        CATEGORY_LABELS[entry.category] ?? entry.category,
        entry.description,
        `${isExpense ? "-" : "+"}${formatCurrency(entry.value)}`,
        entry.status === "PAGO" ? "Pago" : "Pendente",
      ]

      const rowHeight = Math.max(
        14,
        ...cells.map((value, i) =>
          doc.heightOfString(value, { width: COL_WIDTHS[i] - 6 })
        )
      )

      // Quebra de página se a linha não couber
      if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 36) {
        doc.addPage()
        drawTableHeader(doc)
      }

      const rowTop = doc.y
      let x = left
      cells.forEach((value, i) => {
        const isRight = i >= 4
        doc.fontSize(8.5)
          .font(i === 3 ? "Helvetica" : "Helvetica")
          .fillColor(isExpense && i === 4 ? "#b91c1c" : "#000000")
        doc.text(value, x, rowTop, {
          width: COL_WIDTHS[i] - 6,
          align: isRight ? "right" : "left",
        })
        x += COL_WIDTHS[i]
      })
      doc.fillColor("#000000")
      doc.y = rowTop + rowHeight + 3
      if (index < data.entries.length - 1) {
        doc.moveTo(left, doc.y)
          .lineTo(right, doc.y)
          .strokeColor("#eeeeee")
          .stroke()
        doc.moveDown(0.4)
      }
    })
  }

  doc.moveDown(1.5)
  doc.fontSize(8).font("Helvetica").fillColor("#888888")
  doc.text(
    `Documento gerado automaticamente em ${format(data.generatedAt, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}.`,
    { align: "center" }
  )

  doc.end()
  return done
}
