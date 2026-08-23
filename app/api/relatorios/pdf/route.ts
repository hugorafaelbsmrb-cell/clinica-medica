import { NextResponse } from "next/server"
import { startOfMonth, endOfMonth } from "date-fns"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getClinicSettings } from "@/lib/clinic"
import {
  generateFinancialReportPdf,
  type FinancialReportEntry,
} from "@/lib/pdf/relatorio-pdf"

export const dynamic = "force-dynamic"

/**
 * Exporta o relatório financeiro em PDF dentro de um período.
 * Ex.: /api/relatorios/pdf?de=2026-01-01&ate=2026-01-31
 * Protegida por sessão (ADMIN, MEDICO, FINANCEIRO).
 */
export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const allowed = ["ADMIN", "MEDICO", "FINANCEIRO"].includes(
    session.user.role
  )
  if (!allowed) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const de = searchParams.get("de")
  const ate = searchParams.get("ate")

  const now = new Date()
  const from = de ? new Date(`${de}T00:00:00`) : startOfMonth(now)
  const to = ate ? new Date(`${ate}T23:59:59`) : endOfMonth(now)

  if (from.getTime() > to.getTime()) {
    return NextResponse.json(
      { error: "Período inválido: data inicial maior que a final" },
      { status: 400 }
    )
  }

  const [entries, clinic] = await Promise.all([
    prisma.financialEntry.findMany({
      where: { dueDate: { gte: from, lte: to } },
      orderBy: { dueDate: "asc" },
    }),
    getClinicSettings(),
  ])

  // Mesmos indicadores da página de relatórios
  const receitaPaga = entries
    .filter((e) => e.type === "RECEITA" && e.status === "PAGO")
    .reduce((acc, e) => acc + Number(e.value), 0)
  const aReceber = entries
    .filter((e) => e.type === "RECEITA" && e.status === "PENDENTE")
    .reduce((acc, e) => acc + Number(e.value), 0)
  const despesas = entries
    .filter((e) => e.type === "DESPESA")
    .reduce((acc, e) => acc + Number(e.value), 0)

  const pdf = await generateFinancialReportPdf({
    clinic,
    from,
    to,
    generatedAt: now,
    receitaPaga,
    aReceber,
    despesas,
    entries: entries.map(
      (entry): FinancialReportEntry => ({
        dueDate: entry.dueDate,
        type: entry.type,
        category: entry.category,
        description: entry.description,
        value: Number(entry.value),
        status: entry.status,
      })
    ),
  })

  const filename = `relatorio-financeiro-${de ?? "inicio"}-a-${ate ?? "hoje"}.pdf`
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
