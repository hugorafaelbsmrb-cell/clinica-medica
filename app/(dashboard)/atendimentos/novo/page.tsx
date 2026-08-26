import type { Metadata } from "next"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { listActiveDoctors } from "@/lib/doctor"
import { AttendanceForm } from "@/components/atendimentos/atendimento-form"

export const metadata: Metadata = { title: "Novo atendimento" }

export default async function NovoAtendimentoPage({
  searchParams,
}: {
  searchParams: Promise<{ paciente?: string }>
}) {
  const session = requireRole(await auth(), ["ADMIN", "MEDICO", "SECRETARIA"])

  const { paciente } = await searchParams
  const [patients, doctors] = await Promise.all([
    prisma.patient.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        street: true,
        number: true,
        neighborhood: true,
        city: true,
        state: true,
        latitude: true,
        longitude: true,
      },
    }),
    listActiveDoctors(),
  ])

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
        doctors={doctors}
        showDoctorSelect={session.user.role !== "MEDICO"}
        preselectedPatientId={paciente}
      />
    </div>
  )
}
