import Link from "next/link"
import type { Metadata } from "next"
import { format, startOfMonth, endOfMonth } from "date-fns"
import { ptBR } from "date-fns/locale"
import {
  Download,
  FileText,
  Stethoscope,
  Wallet,
  Hourglass,
  MapPin,
} from "lucide-react"
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

export const metadata: Metadata = { title: "Relatórios" }

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value)
}

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>
}) {
  const session = await auth()
  requireRole(session, ["ADMIN", "MEDICO", "FINANCEIRO"])

  const { de, ate } = await searchParams

  const from = de ? new Date(`${de}T00:00:00`) : startOfMonth(new Date())
  const to = ate ? new Date(`${ate}T23:59:59`) : endOfMonth(new Date())

  const [attendances, entries] = await Promise.all([
    prisma.attendance.findMany({
      where: { scheduledAt: { gte: from, lte: to } },
      include: { patient: true },
      orderBy: { scheduledAt: "asc" },
    }),
    prisma.financialEntry.findMany({
      where: { dueDate: { gte: from, lte: to } },
    }),
  ])

  // Indicadores de atendimento
  const realizados = attendances.filter((a) => a.status === "REALIZADO")
  const valorRealizado = realizados.reduce(
    (acc, a) => acc + Number(a.value),
    0
  )
  const ticketMedio =
    realizados.length > 0 ? valorRealizado / realizados.length : 0

  // Regiões mais atendidas (bairro -> contagem + valor)
  const byNeighborhood = new Map<string, { count: number; value: number }>()
  for (const attendance of realizados) {
    const key = attendance.patient.neighborhood?.trim() || "Não informado"
    const current = byNeighborhood.get(key) ?? { count: 0, value: 0 }
    current.count += 1
    current.value += Number(attendance.value)
    byNeighborhood.set(key, current)
  }
  const neighborhoods = [...byNeighborhood.entries()]
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.count - a.count)

  const presenciais = realizados.filter((a) => a.type === "PRESENCIAL").length
  const domiciliares = realizados.filter((a) => a.type === "DOMICILIAR").length

  // Indicadores financeiros do período
  const receitaPaga = entries
    .filter((e) => e.type === "RECEITA" && e.status === "PAGO")
    .reduce((acc, e) => acc + Number(e.value), 0)
  const aReceber = entries
    .filter((e) => e.type === "RECEITA" && e.status === "PENDENTE")
    .reduce((acc, e) => acc + Number(e.value), 0)
  const despesas = entries
    .filter((e) => e.type === "DESPESA")
    .reduce((acc, e) => acc + Number(e.value), 0)

  const deQuery = de ?? format(from, "yyyy-MM-dd")
  const ateQuery = ate ?? format(to, "yyyy-MM-dd")

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
          <p className="text-muted-foreground">
            {format(from, "dd/MM/yyyy", { locale: ptBR })} até{" "}
            {format(to, "dd/MM/yyyy", { locale: ptBR })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action="/relatorios" method="get" className="flex gap-2">
            <input
              type="date"
              name="de"
              defaultValue={de ?? format(from, "yyyy-MM-dd")}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            />
            <input
              type="date"
              name="ate"
              defaultValue={ate ?? format(to, "yyyy-MM-dd")}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            />
            <Button type="submit" variant="outline" size="sm">
              Aplicar
            </Button>
          </form>
          <Button
            variant="outline"
            size="sm"
            render={
              <Link
                href={`/api/relatorios/csv?tipo=atendimentos&de=${deQuery}&ate=${ateQuery}`}
              />
            }
          >
            <Download className="h-4 w-4" />
            CSV atendimentos
          </Button>
          <Button
            variant="outline"
            size="sm"
            render={
              <Link
                href={`/api/relatorios/csv?tipo=financeiro&de=${deQuery}&ate=${ateQuery}`}
              />
            }
          >
            <Download className="h-4 w-4" />
            CSV financeiro
          </Button>
          <Button
            variant="outline"
            size="sm"
            render={
              <Link href={`/api/relatorios/pdf?de=${deQuery}&ate=${ateQuery}`} />
            }
          >
            <FileText className="h-4 w-4" />
            PDF financeiro
          </Button>
        </div>
      </div>

      {/* Indicadores */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Atendimentos</CardTitle>
            <Stethoscope className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{realizados.length}</p>
            <p className="text-xs text-muted-foreground">
              {presenciais} presenciais · {domiciliares} domiciliares
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Valor dos atendimentos
            </CardTitle>
            <Wallet className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {formatCurrency(valorRealizado)}
            </p>
            <p className="text-xs text-muted-foreground">
              Ticket médio: {formatCurrency(ticketMedio)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Receita paga</CardTitle>
            <Wallet className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {formatCurrency(receitaPaga)}
            </p>
            <p className="text-xs text-muted-foreground">
              Despesas: {formatCurrency(despesas)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">A receber</CardTitle>
            <Hourglass className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {formatCurrency(aReceber)}
            </p>
            <p className="text-xs text-muted-foreground">
              lançamentos pendentes no período
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Regiões mais atendidas */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Regiões mais atendidas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {neighborhoods.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Sem atendimentos no período
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bairro</TableHead>
                    <TableHead className="text-right">Atendimentos</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {neighborhoods.map((neighborhood) => (
                    <TableRow key={neighborhood.name}>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                          {neighborhood.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {neighborhood.count}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(neighborhood.value)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Detalhamento de atendimentos */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Atendimentos realizados
            </CardTitle>
          </CardHeader>
          <CardContent>
            {realizados.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Sem atendimentos realizados no período
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Paciente</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {realizados.slice(0, 15).map((attendance) => (
                    <TableRow key={attendance.id}>
                      <TableCell>
                        {format(attendance.scheduledAt, "dd/MM/yyyy", {
                          locale: ptBR,
                        })}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/atendimentos/${attendance.id}`}
                          className="font-medium hover:underline"
                        >
                          {attendance.patient.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {attendance.type === "PRESENCIAL"
                            ? "Presencial"
                            : "Domiciliar"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(Number(attendance.value))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
