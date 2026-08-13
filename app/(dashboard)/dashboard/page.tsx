import Link from "next/link"
import { redirect } from "next/navigation"
import type { Metadata } from "next"
import { format, startOfMonth, subDays, startOfDay } from "date-fns"
import { ptBR } from "date-fns/locale"
import {
  Stethoscope,
  CalendarClock,
  Users,
  Wallet,
  MessageCircle,
  ArrowRight,
} from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AttendancesChart,
  type AttendanceChartPoint,
} from "@/components/dashboard/attendances-chart"

export const metadata: Metadata = { title: "Dashboard" }

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value)
}

export default async function DashboardPage() {
  const session = await auth()
  requireRole(session, ["ADMIN", "MEDICO", "SECRETARIA", "FINANCEIRO"])

  const now = new Date()
  const monthStart = startOfMonth(now)
  const nextMonthStart = startOfMonth(
    new Date(now.getFullYear(), now.getMonth() + 1, 1)
  )

  const [
    atendimentosMes,
    agendadosFuturos,
    pacientesTotal,
    receitaMes,
    mensagensMes,
    atendimentosPeriodo,
    proximosAtendimentos,
  ] = await Promise.all([
    prisma.attendance.count({
      where: { status: "REALIZADO", scheduledAt: { gte: monthStart, lt: nextMonthStart } },
    }),
    prisma.attendance.count({
      where: { status: "AGENDADO", scheduledAt: { gte: now } },
    }),
    prisma.patient.count(),
    prisma.financialEntry.aggregate({
      where: {
        type: "RECEITA",
        status: "PAGO",
        dueDate: { gte: monthStart, lt: nextMonthStart },
      },
      _sum: { value: true },
    }),
    prisma.message.count({
      where: {
        direction: "OUT",
        status: { in: ["ENVIADA", "ENTREGUE", "LIDA"] },
        sentAt: { gte: monthStart, lt: nextMonthStart },
      },
    }),
    // Atendimentos dos últimos 14 dias (exceto cancelados) para o gráfico
    prisma.attendance.findMany({
      where: {
        scheduledAt: { gte: subDays(startOfDay(now), 13) },
        status: { not: "CANCELADO" },
      },
      select: { scheduledAt: true },
    }),
    prisma.attendance.findMany({
      where: { status: "AGENDADO", scheduledAt: { gte: now } },
      orderBy: { scheduledAt: "asc" },
      take: 5,
      include: { patient: true },
    }),
  ])

  // Agrega por dia
  const chartData: AttendanceChartPoint[] = Array.from({ length: 14 }, (_, i) => {
    const date = subDays(startOfDay(now), 13 - i)
    const key = format(date, "yyyy-MM-dd")
    return {
      day: format(date, "dd/MM", { locale: ptBR }),
      total: atendimentosPeriodo.filter(
        (attendance) => format(attendance.scheduledAt, "yyyy-MM-dd") === key
      ).length,
    }
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Visão geral da clínica —{" "}
          {format(now, "MMMM 'de' yyyy", { locale: ptBR })}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Atendimentos no mês
            </CardTitle>
            <Stethoscope className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent className="flex items-baseline justify-between">
            <span className="text-2xl font-semibold">{atendimentosMes}</span>
            <Link
              href="/atendimentos"
              className="text-xs text-muted-foreground hover:underline"
            >
              ver todos
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Agendados</CardTitle>
            <CalendarClock className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent className="flex items-baseline justify-between">
            <span className="text-2xl font-semibold">{agendadosFuturos}</span>
            <Link
              href="/atendimentos?status=AGENDADO"
              className="text-xs text-muted-foreground hover:underline"
            >
              agenda
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pacientes</CardTitle>
            <Users className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent className="flex items-baseline justify-between">
            <span className="text-2xl font-semibold">{pacientesTotal}</span>
            <Link
              href="/pacientes"
              className="text-xs text-muted-foreground hover:underline"
            >
              cadastros
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Receita no mês</CardTitle>
            <Wallet className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent className="flex items-baseline justify-between">
            <span className="text-2xl font-semibold">
              {formatCurrency(Number(receitaMes._sum.value ?? 0))}
            </span>
            <Link
              href="/financeiro"
              className="text-xs text-muted-foreground hover:underline"
            >
              financeiro
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Gráfico */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              Atendimentos — últimos 14 dias
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AttendancesChart data={chartData} />
          </CardContent>
        </Card>

        {/* Próximos atendimentos */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Próximos atendimentos</CardTitle>
            <Link
              href="/atendimentos"
              className="text-xs text-muted-foreground hover:underline"
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardHeader>
          <CardContent>
            {proximosAtendimentos.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhum atendimento agendado
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {proximosAtendimentos.map((attendance) => (
                  <Link
                    key={attendance.id}
                    href={`/atendimentos/${attendance.id}`}
                    className="flex items-center justify-between gap-2 rounded-md border p-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {attendance.patient.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(attendance.scheduledAt, "dd/MM 'às' HH:mm", {
                          locale: ptBR,
                        })}
                      </p>
                    </div>
                    <Badge variant="outline">
                      {attendance.type === "PRESENCIAL"
                        ? "Presencial"
                        : "Domiciliar"}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Mensagens */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            Mensagens enviadas no mês
          </CardTitle>
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <span className="text-2xl font-semibold">{mensagensMes}</span>
          <span className="text-sm text-muted-foreground">
            mensagens de WhatsApp enviadas e entregues em{" "}
            {format(now, "MMMM", { locale: ptBR })}
          </span>
        </CardContent>
      </Card>
    </div>
  )
}
