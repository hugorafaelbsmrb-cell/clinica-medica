import type { Metadata } from "next"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { PlanForm } from "@/components/planos/plano-form"

export const metadata: Metadata = { title: "Novo plano terapêutico" }

export default async function NovoPlanoPage({
  searchParams,
}: {
  searchParams: Promise<{ atendimento?: string }>
}) {
  const session = await auth()
  requireRole(session, ["ADMIN", "MEDICO"])

  const { atendimento } = await searchParams

  const [patients, attendance] = await Promise.all([
    prisma.patient.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    atendimento
      ? prisma.attendance.findUnique({ where: { id: atendimento } })
      : Promise.resolve(null),
  ])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Novo plano terapêutico
        </h1>
        <p className="text-muted-foreground">
          Registre o diagnóstico, as metas e as orientações. O resumo pode ser
          gerado por IA aqui mesmo, antes de salvar.
        </p>
      </div>
      <PlanForm
        patients={patients}
        preselectedPatientId={attendance?.patientId}
      />
    </div>
  )
}
