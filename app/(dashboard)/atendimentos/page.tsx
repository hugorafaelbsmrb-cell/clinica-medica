import Link from "next/link"
import type { Metadata } from "next"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Plus, Stethoscope } from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

export const metadata: Metadata = { title: "Atendimentos" }

const TYPE_LABELS = { PRESENCIAL: "Presencial", DOMICILIAR: "Domiciliar" } as const

const STATUS_VARIANTS = {
  AGENDADO: "secondary",
  REALIZADO: "default",
  CANCELADO: "outline",
} as const

const STATUS_LABELS = {
  AGENDADO: "Agendado",
  REALIZADO: "Realizado",
  CANCELADO: "Cancelado",
} as const

export default async function AtendimentosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const session = await auth()
  requireRole(session, ["ADMIN", "MEDICO", "SECRETARIA"])

  const { status } = await searchParams
  const statusFilter = status
    ? (status.toUpperCase() as "AGENDADO" | "REALIZADO" | "CANCELADO")
    : undefined

  const attendances = await prisma.attendance.findMany({
    where: statusFilter ? { status: statusFilter } : {},
    include: { patient: true, doctor: true },
    orderBy: { scheduledAt: "desc" },
    take: 100,
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Atendimentos</h1>
          <p className="text-muted-foreground">
            Consultas presenciais e domiciliares
          </p>
        </div>
        <Button render={<Link href="/atendimentos/novo" />}>
          <Plus className="h-4 w-4" />
          Novo atendimento
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={!statusFilter ? "default" : "outline"}
          size="sm"
          render={<Link href="/atendimentos" />}
        >
          Todos
        </Button>
        {(["AGENDADO", "REALIZADO", "CANCELADO"] as const).map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            render={<Link href={`/atendimentos?status=${s.toLowerCase()}`} />}
          >
            {STATUS_LABELS[s]}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {statusFilter ? STATUS_LABELS[statusFilter] : "Todos os atendimentos"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {attendances.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
              <Stethoscope className="h-10 w-10" />
              <p>Nenhum atendimento encontrado</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Paciente</TableHead>
                  <TableHead className="hidden sm:table-cell">Tipo</TableHead>
                  <TableHead className="hidden md:table-cell">Médico</TableHead>
                  <TableHead className="hidden md:table-cell">Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendances.map((attendance) => (
                  <TableRow key={attendance.id}>
                    <TableCell>
                      {format(attendance.scheduledAt, "dd/MM/yyyy HH:mm", {
                        locale: ptBR,
                      })}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/pacientes/${attendance.patientId}`}
                        className="font-medium hover:underline"
                      >
                        {attendance.patient.name}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {TYPE_LABELS[attendance.type]}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {attendance.doctor?.name ?? "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      R$ {Number(attendance.value).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[attendance.status]}>
                        {STATUS_LABELS[attendance.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        render={<Link href={`/atendimentos/${attendance.id}`} />}
                      >
                        Ver
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
