import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { format } from "date-fns"

export const dynamic = "force-dynamic"

/**
 * Exporta CSV de atendimentos ou financeiro dentro de um período.
 * Ex.: /api/relatorios/csv?tipo=atendimentos&de=2026-01-01&ate=2026-01-31
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
  const tipo = searchParams.get("tipo") ?? "atendimentos"
  const de = searchParams.get("de")
  const ate = searchParams.get("ate")

  const from = de ? new Date(`${de}T00:00:00`) : new Date(0)
  const to = ate
    ? new Date(`${ate}T23:59:59`)
    : new Date(2100, 0, 1)

  if (from.getTime() > to.getTime()) {
    return NextResponse.json(
      { error: "Período inválido: data inicial maior que a final" },
      { status: 400 }
    )
  }

  let csv = ""

  if (tipo === "financeiro") {
    const entries = await prisma.financialEntry.findMany({
      where: { dueDate: { gte: from, lte: to } },
      orderBy: { dueDate: "asc" },
    })

    csv = [
      "Vencimento;Tipo;Categoria;Descrição;Valor;Status",
      ...entries.map((entry) =>
        [
          format(entry.dueDate, "dd/MM/yyyy"),
          entry.type === "RECEITA" ? "Receita" : "Despesa",
          entry.category,
          entry.description.replace(/;/g, ","),
          entry.value.toString().replace(".", ","),
          entry.status === "PAGO" ? "Pago" : "Pendente",
        ].join(";")
      ),
    ].join("\n")
  } else {
    const attendances = await prisma.attendance.findMany({
      where: { scheduledAt: { gte: from, lte: to } },
      orderBy: { scheduledAt: "asc" },
      include: { patient: true, doctor: true },
    })

    csv = [
      "Data;Paciente;Tipo;Status;Bairro;Cidade;Médico;Valor",
      ...attendances.map((attendance) =>
        [
          format(attendance.scheduledAt, "dd/MM/yyyy HH:mm"),
          attendance.patient.name,
          attendance.type === "PRESENCIAL" ? "Presencial" : "Domiciliar",
          attendance.status === "REALIZADO"
            ? "Realizado"
            : attendance.status === "CANCELADO"
              ? "Cancelado"
              : "Agendado",
          attendance.patient.neighborhood ?? "",
          attendance.patient.city ?? "",
          attendance.doctor?.name ?? "",
          attendance.value.toString().replace(".", ","),
        ].join(";")
      ),
    ].join("\n")
  }

  // BOM para abrir corretamente no Excel
  const filename = `${tipo}-${de ?? "inicio"}-a-${ate ?? "hoje"}.csv`
  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
