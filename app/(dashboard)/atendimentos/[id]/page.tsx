import Link from "next/link"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { ArrowLeft } from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { AttendanceActions } from "./attendance-actions"

export const metadata: Metadata = { title: "Detalhes do atendimento" }

const TYPE_LABELS = { PRESENCIAL: "Presencial", DOMICILIAR: "Domiciliar" } as const

const STATUS_LABELS = {
  AGENDADO: "Agendado",
  EM_ATENDIMENTO: "Em atendimento",
  REALIZADO: "Realizado",
  CANCELADO: "Cancelado",
} as const

export default async function AtendimentoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  requireRole(session, ["ADMIN", "MEDICO", "SECRETARIA"])

  const { id } = await params
  const attendance = await prisma.attendance.findUnique({
    where: { id },
    include: { patient: true, doctor: true },
  })

  if (!attendance) notFound()

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          render={<Link href="/atendimentos" />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Atendimento — {attendance.patient.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {format(attendance.scheduledAt, "dd 'de' MMMM 'de' yyyy 'às' HH:mm", {
              locale: ptBR,
            })}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline">{TYPE_LABELS[attendance.type]}</Badge>
        <Badge variant="secondary">{STATUS_LABELS[attendance.status]}</Badge>
        <span className="text-sm text-muted-foreground">
          Valor: R$ {Number(attendance.value).toFixed(2)}
        </span>
      </div>

      <AttendanceActions
        attendanceId={attendance.id}
        status={attendance.status}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Informações</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div>
            <p className="text-muted-foreground">Paciente</p>
            <Link
              href={`/pacientes/${attendance.patientId}`}
              className="font-medium hover:underline"
            >
              {attendance.patient.name}
            </Link>
          </div>
          <div>
            <p className="text-muted-foreground">Médico responsável</p>
            <p>{attendance.doctor?.name ?? "A definir"}</p>
          </div>
          {attendance.type === "DOMICILIAR" && (
            <div>
              <p className="text-muted-foreground">Endereço do domicílio</p>
              <p>{attendance.homeAddress}</p>
            </div>
          )}
          <Separator />
          <div>
            <p className="text-muted-foreground">Anamnese</p>
            <p className="whitespace-pre-wrap">
              {attendance.anamnesis ?? "Sem registro ainda."}
            </p>
          </div>
        </CardContent>
      </Card>

      {attendance.status !== "CANCELADO" && (
        <Button
          variant="outline"
          render={
            <Link href={`/prescricoes/novo?atendimento=${attendance.id}`} />
          }
        >
          Criar prescrição para este atendimento
        </Button>
      )}
    </div>
  )
}
