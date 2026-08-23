import Link from "next/link"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { ArrowLeft, HeartPulse } from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { FollowUpActions } from "@/components/acompanhamentos/followup-actions"

export const metadata: Metadata = { title: "Detalhes do acompanhamento" }

const COMPLEXITY_LABELS = {
  BAIXA: "Baixa",
  MEDIA: "Média",
  ALTA: "Alta",
} as const

const COMPLEXITY_VARIANTS = {
  BAIXA: "secondary",
  MEDIA: "default",
  ALTA: "destructive",
} as const

const STATUS_LABELS = {
  ATIVO: "Ativo",
  PAUSADO: "Pausado",
  CONCLUIDO: "Concluído",
  CANCELADO: "Cancelado",
} as const

const STATUS_VARIANTS = {
  ATIVO: "default",
  PAUSADO: "secondary",
  CONCLUIDO: "outline",
  CANCELADO: "ghost",
} as const

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDENTE: "Pendente",
  PAGO: "Pago",
  EXPIRADO: "Expirado",
  CANCELADO: "Cancelado",
  FALHOU: "Falhou",
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  PIX: "PIX",
  CARTAO: "Cartão",
  APPLE_PAY: "Apple Pay",
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value)
}

type TimelineItem = {
  id: string
  kind: "avaliacao" | "plano" | "prescricao"
  date: Date
  title: string
  subtitle?: string
  body: string
}

export default async function AcompanhamentoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  requireRole(session, ["ADMIN", "MEDICO"])

  const { id } = await params
  const program = await prisma.followUpProgram.findUnique({
    where: { id },
    include: {
      patient: true,
      doctor: true,
      payments: { orderBy: { createdAt: "desc" } },
      evaluations: {
        include: { doctor: true },
        orderBy: { createdAt: "desc" },
      },
    },
  })

  if (!program) notFound()

  const [plans, prescriptions] = await Promise.all([
    prisma.therapeuticPlan.findMany({
      where: { patientId: program.patientId },
      include: { doctor: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.prescription.findMany({
      where: { patientId: program.patientId },
      include: { items: true, doctor: true },
      orderBy: { createdAt: "desc" },
    }),
  ])

  // Linha do tempo clínica: diagnósticos (planos), prescrições, planos
  // terapêuticos e avaliações — mais recentes primeiro.
  const timeline: TimelineItem[] = [
    ...program.evaluations.map((evaluation) => ({
      id: evaluation.id,
      kind: "avaliacao" as const,
      date: evaluation.createdAt,
      title: `Avaliação — ${evaluation.doctor?.name ?? "Equipe"}`,
      body: evaluation.notes,
    })),
    ...plans.map((plan) => ({
      id: plan.id,
      kind: "plano" as const,
      date: plan.createdAt,
      title: `Plano terapêutico — ${plan.doctor?.name ?? "Equipe"}`,
      subtitle: plan.diagnosis,
      body: [plan.goals, plan.guidelines, plan.summary].filter(Boolean).join("\n"),
    })),
    ...prescriptions.map((prescription) => ({
      id: prescription.id,
      kind: "prescricao" as const,
      date: prescription.createdAt,
      title: `Prescrição — ${prescription.doctor?.name ?? "Equipe"}`,
      body: prescription.items
        .map((item) =>
          [item.medication, item.dosage, item.frequency, item.duration]
            .filter(Boolean)
            .join(" — ")
        )
        .join("\n"),
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime())

  const paidCount = program.payments.filter((p) => p.status === "PAGO").length

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          render={<Link href="/acompanhamentos" />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <HeartPulse className="h-6 w-6 text-primary" />
            {program.patient.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Acompanhamento iniciado em{" "}
            {format(program.startDate, "dd/MM/yyyy", { locale: ptBR })}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Badge variant={COMPLEXITY_VARIANTS[program.complexity]}>
            Complexidade {COMPLEXITY_LABELS[program.complexity]}
          </Badge>
          <Badge variant={STATUS_VARIANTS[program.status]}>
            {STATUS_LABELS[program.status]}
          </Badge>
        </div>
      </div>

      <FollowUpActions
        followUpId={program.id}
        status={program.status}
        patientId={program.patientId}
        patientName={program.patient.name}
        sugestaoCobranca={
          Number(program.baseValue) > 0 ? Number(program.baseValue) : null
        }
      />

      {program.description && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Motivo do acompanhamento</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {program.description}
          </CardContent>
        </Card>
      )}

      {/* Dados do programa */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados do programa</CardTitle>
          <CardDescription>
            {program.billingMode === "INTEGRAL"
              ? "Cobrança integral"
              : `Cobrança recorrente a cada ${program.cycleDays} dias`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Paciente</p>
            <Link
              href={`/pacientes/${program.patientId}`}
              className="font-medium hover:underline"
            >
              {program.patient.name}
            </Link>
          </div>
          <div>
            <p className="text-muted-foreground">Médico responsável</p>
            <p>{program.doctor?.name ?? "A definir"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">
              {program.billingMode === "INTEGRAL"
                ? "Valor base"
                : "Valor por ciclo"}
            </p>
            <p className="font-medium">
              {formatCurrency(Number(program.baseValue))}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">
              {program.billingMode === "INTEGRAL" ? "Valor total" : "Valor total do programa"}
            </p>
            <p className="font-medium">
              {formatCurrency(Number(program.totalValue))}
            </p>
          </div>
          {program.installments && (
            <div>
              <p className="text-muted-foreground">Parcelamento no cartão</p>
              <p className="font-medium">
                {program.installments}x de{" "}
                {formatCurrency(Number(program.installmentValue ?? 0))}
              </p>
            </div>
          )}
          <div>
            <p className="text-muted-foreground">Próxima cobrança</p>
            <p>
              {program.nextDueAt
                ? format(program.nextDueAt, "dd/MM/yyyy", { locale: ptBR })
                : "—"}
            </p>
          </div>
          {program.endDate && (
            <div>
              <p className="text-muted-foreground">Encerrado em</p>
              <p>{format(program.endDate, "dd/MM/yyyy", { locale: ptBR })}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Histórico de cobranças */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Cobranças ({paidCount} pagas de {program.payments.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {program.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma cobrança registrada ainda.
            </p>
          ) : (
            <div className="flex flex-col">
              {program.payments.map((payment, index) => (
                <div key={payment.id}>
                  {index > 0 && <Separator className="my-3" />}
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {program.billingMode === "RECORRENTE" &&
                        payment.cycleNumber
                          ? `Ciclo ${payment.cycleNumber}`
                          : "Cobrança"}
                        {payment.installments
                          ? ` — ${payment.installments}x no cartão`
                          : ` — ${PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(payment.createdAt, "dd/MM/yyyy 'às' HH:mm", {
                          locale: ptBR,
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {formatCurrency(Number(payment.amount))}
                      </span>
                      <Badge
                        variant={
                          payment.status === "PAGO"
                            ? "default"
                            : payment.status === "PENDENTE"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Linha do tempo clínica */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evolução clínica</CardTitle>
          <CardDescription>
            Diagnósticos, prescrições, planos terapêuticos e avaliações — mais
            recentes primeiro.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ainda não há registros clínicos para este paciente. Use{" "}
              <strong>Nova avaliação</strong>, <strong>Nova prescrição</strong>{" "}
              ou <strong>Novo plano terapêutico</strong> acima.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {timeline.map((item) => (
                <div
                  key={`${item.kind}-${item.id}`}
                  className="flex flex-col gap-1 rounded-lg border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <HeartPulse
                        className={
                          item.kind === "avaliacao"
                            ? "h-3.5 w-3.5 text-primary"
                            : "h-3.5 w-3.5 text-muted-foreground"
                        }
                      />
                      {item.title}
                    </p>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {format(item.date, "dd/MM/yyyy 'às' HH:mm", {
                        locale: ptBR,
                      })}
                    </span>
                  </div>
                  {item.subtitle && (
                    <p className="text-sm font-medium text-primary/80">
                      {item.subtitle}
                    </p>
                  )}
                  <p className="whitespace-pre-line text-sm text-muted-foreground">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
