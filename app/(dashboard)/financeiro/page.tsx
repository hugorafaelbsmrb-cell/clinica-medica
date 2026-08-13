import Link from "next/link"
import type { Metadata } from "next"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Plus, Wallet, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToggleStatusButton } from "./toggle-status-button"
import { DeleteEntryButton } from "./delete-entry-button"

export const metadata: Metadata = { title: "Financeiro" }

const CATEGORY_LABELS: Record<string, string> = {
  CONSULTA_PRESENCIAL: "Consulta presencial",
  CONSULTA_DOMICILIAR: "Consulta domiciliar",
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

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; mes?: string }>
}) {
  const session = await auth()
  requireRole(session, ["ADMIN", "FINANCEIRO"])

  const { status, type, mes } = await searchParams

  // Filtros
  const where: Record<string, unknown> = {}
  if (status === "PAGO" || status === "PENDENTE") where.status = status
  if (type === "RECEITA" || type === "DESPESA") where.type = type
  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    const [year, month] = mes.split("-").map(Number)
    where.dueDate = {
      gte: new Date(year, month - 1, 1),
      lte: new Date(year, month, 0, 23, 59, 59),
    }
  }

  const entries = await prisma.financialEntry.findMany({
    where,
    orderBy: { dueDate: "desc" },
  })

  // Resumo calculado sobre o conjunto filtrado
  const now = new Date()
  const sum = (list: typeof entries) =>
    list.reduce((acc, entry) => acc + Number(entry.value), 0)

  const receitasPagas = sum(
    entries.filter((e) => e.type === "RECEITA" && e.status === "PAGO")
  )
  const aReceber = sum(
    entries.filter((e) => e.type === "RECEITA" && e.status === "PENDENTE")
  )
  const despesasPagas = sum(
    entries.filter((e) => e.type === "DESPESA" && e.status === "PAGO")
  )
  const inadimplencia = sum(
    entries.filter(
      (e) =>
        e.type === "RECEITA" &&
        e.status === "PENDENTE" &&
        e.dueDate.getTime() < now.getTime()
    )
  )

  const buildHref = (params: Record<string, string | undefined>) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value) query.set(key, value)
    }
    const qs = query.toString()
    return qs ? `/financeiro?${qs}` : "/financeiro"
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
          <p className="text-muted-foreground">
            Lançamentos, contas a receber e inadimplência
          </p>
        </div>
        <Button render={<Link href="/financeiro/novo" />}>
          <Plus className="h-4 w-4" />
          Novo lançamento
        </Button>
      </div>

      {/* Resumo */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Receitas pagas</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {formatCurrency(receitasPagas)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">A receber</CardTitle>
            <Wallet className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {formatCurrency(aReceber)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Despesas pagas</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {formatCurrency(despesasPagas)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inadimplência</CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent
            className={`text-2xl font-semibold ${
              inadimplencia > 0 ? "text-amber-600" : ""
            }`}
          >
            {formatCurrency(inadimplencia)}
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={!status ? "default" : "outline"}
          size="sm"
          render={<Link href={buildHref({ type, mes })} />}
        >
          Todos
        </Button>
        <Button
          variant={status === "PENDENTE" ? "default" : "outline"}
          size="sm"
          render={<Link href={buildHref({ status: "PENDENTE", type, mes })} />}
        >
          Pendentes
        </Button>
        <Button
          variant={status === "PAGO" ? "default" : "outline"}
          size="sm"
          render={<Link href={buildHref({ status: "PAGO", type, mes })} />}
        >
          Pagos
        </Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button
          variant={type === "RECEITA" ? "default" : "outline"}
          size="sm"
          render={<Link href={buildHref({ status, type: "RECEITA", mes })} />}
        >
          Receitas
        </Button>
        <Button
          variant={type === "DESPESA" ? "default" : "outline"}
          size="sm"
          render={<Link href={buildHref({ status, type: "DESPESA", mes })} />}
        >
          Despesas
        </Button>
        <form action="/financeiro" method="get" className="ml-auto flex gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          {type && <input type="hidden" name="type" value={type} />}
          <input
            type="month"
            name="mes"
            defaultValue={mes ?? ""}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          />
          <Button type="submit" variant="outline" size="sm">
            Filtrar mês
          </Button>
        </form>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Lançamentos ({entries.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
              <Wallet className="h-10 w-10" />
              <p>Nenhum lançamento encontrado</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const isOverdue =
                    entry.status === "PENDENTE" &&
                    entry.dueDate.getTime() < now.getTime()
                  return (
                    <TableRow key={entry.id}>
                      <TableCell>
                        {format(entry.dueDate, "dd/MM/yyyy", { locale: ptBR })}
                      </TableCell>
                      <TableCell className="font-medium">
                        {entry.description}
                        {entry.paymentMethod && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {entry.paymentMethod}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {CATEGORY_LABELS[entry.category] ?? entry.category}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            entry.type === "RECEITA" ? "secondary" : "outline"
                          }
                        >
                          {entry.type === "RECEITA" ? "Receita" : "Despesa"}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${
                          entry.type === "DESPESA"
                            ? "text-red-600"
                            : "text-emerald-600"
                        }`}
                      >
                        {entry.type === "DESPESA" ? "−" : "+"}
                        {formatCurrency(Number(entry.value))}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={entry.status === "PAGO" ? "default" : "outline"}
                          className={isOverdue ? "border-amber-500 text-amber-600" : ""}
                        >
                          {entry.status === "PAGO" ? "Pago" : "Pendente"}
                        </Badge>
                      </TableCell>
                      <TableCell className="flex justify-end gap-2">
                        <ToggleStatusButton
                          entryId={entry.id}
                          isPaid={entry.status === "PAGO"}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          render={
                            <Link href={`/financeiro/${entry.id}/editar`} />
                          }
                        >
                          Editar
                        </Button>
                        <DeleteEntryButton entryId={entry.id} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
