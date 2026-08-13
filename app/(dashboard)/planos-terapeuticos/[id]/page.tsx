import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { ArrowLeft, Pencil, Sparkles } from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ApprovePlanButton } from "./approve-button"

export const metadata: Metadata = { title: "Plano terapêutico" }

const STATUS_LABELS = {
  RASCUNHO: "Rascunho",
  GERADO: "Gerado por IA",
  APROVADO: "Aprovado",
} as const

export default async function PlanoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  requireRole(session, ["ADMIN", "MEDICO"])

  const { id } = await params

  const plan = await prisma.therapeuticPlan.findUnique({
    where: { id },
    include: { patient: true, doctor: true },
  })

  if (!plan) notFound()

  const canApprove = Boolean(plan.summary) && plan.status !== "APROVADO"

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            render={<Link href="/planos-terapeuticos" />}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Plano terapêutico
            </h1>
            <p className="text-muted-foreground">
              {plan.patient.name} —{" "}
              {format(plan.updatedAt, "dd/MM/yyyy", { locale: ptBR })}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            render={<Link href={`/planos-terapeuticos/${plan.id}/editar`} />}
          >
            <Pencil className="h-4 w-4" />
            Editar
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={plan.status === "APROVADO" ? "default" : "outline"}
        >
          {STATUS_LABELS[plan.status]}
        </Badge>
        {plan.source === "IA" && (
          <Badge variant="secondary">
            <Sparkles className="mr-1 h-3 w-3" />
            Resumo gerado por IA
          </Badge>
        )}
        <span className="text-sm text-muted-foreground">
          Médico: {plan.doctor?.name ?? "—"}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Diagnóstico</CardTitle>
        </CardHeader>
        <CardContent className="whitespace-pre-wrap text-sm">
          {plan.diagnosis}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Metas do tratamento</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">
            {plan.goals || <span className="text-muted-foreground">—</span>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Orientações e condutas</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">
            {plan.guidelines || <span className="text-muted-foreground">—</span>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Resumo do plano para o paciente
          </CardTitle>
        </CardHeader>
        <CardContent>
          {plan.summary ? (
            <p className="whitespace-pre-wrap text-sm">{plan.summary}</p>
          ) : (
            <div className="flex flex-col items-center gap-3 py-6 text-muted-foreground">
              <p className="text-sm">
                Nenhum resumo ainda. Edite o plano para gerar o resumo com IA
                ou preenchê-lo manualmente.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {canApprove && (
        <div className="flex justify-end">
          <ApprovePlanButton planId={plan.id} />
        </div>
      )}
    </div>
  )
}
