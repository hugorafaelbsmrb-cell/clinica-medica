import type { Metadata } from "next"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { AttendanceForm } from "@/components/atendimentos/atendimento-form"

export const metadata: Metadata = { title: "Novo atendimento" }

export default async function NovoAtendimentoPage({
  searchParams,
}: {
  searchParams: Promise<{ paciente?: string }>
}) {
  const session = await auth()
  requireRole(session, ["ADMIN", "MEDICO", "SECRETARIA"])

  const { paciente } = await searchParams
  const patients = await prisma.patient.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, neighborhood: true },
  })

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Novo atendimento</h1>
        <p className="text-muted-foreground">
          Agende uma consulta presencial ou domiciliar.
        </p>
      </div>
      <AttendanceForm
        patients={patients}
        preselectedPatientId={paciente}
      />
    </div>
  )
}
