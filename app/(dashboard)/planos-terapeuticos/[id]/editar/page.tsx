import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { ArrowLeft } from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { Button } from "@/components/ui/button"
import { PlanForm } from "@/components/planos/plano-form"

export const metadata: Metadata = { title: "Editar plano terapêutico" }

export default async function EditarPlanoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  requireRole(session, ["ADMIN", "MEDICO"])

  const { id } = await params

  const plan = await prisma.therapeuticPlan.findUnique({ where: { id } })
  if (!plan) notFound()

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          render={<Link href={`/planos-terapeuticos/${id}`} />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Editar plano terapêutico
          </h1>
          <p className="text-muted-foreground">
            Ajuste o diagnóstico, as metas e as orientações
          </p>
        </div>
      </div>
      <PlanForm
        patients={[]}
        doctors={[]}
        showDoctorSelect={false}
        initial={{
          id: plan.id,
          patientId: plan.patientId,
          diagnosis: plan.diagnosis,
          goals: plan.goals,
          guidelines: plan.guidelines,
          summary: plan.summary,
        }}
      />
    </div>
  )
}
