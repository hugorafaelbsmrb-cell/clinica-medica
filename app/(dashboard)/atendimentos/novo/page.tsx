import type { Metadata } from "next"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { listActiveDoctors } from "@/lib/doctor"
import { getClinicSettings } from "@/lib/clinic"
import { AttendanceForm } from "@/components/atendimentos/atendimento-form"

export const metadata: Metadata = { title: "Novo atendimento" }

export default async function NovoAtendimentoPage({
  searchParams,
}: {
  searchParams: Promise<{ paciente?: string }>
}) {
  const session = requireRole(await auth(), ["ADMIN", "MEDICO", "SECRETARIA"])

  const { paciente } = await searchParams
  const [patients, doctors, clinic] = await Promise.all([
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
    getClinicSettings(),
  ])

  // Dica visual: o time interno agenda todos os tipos, mas o público
  // só oferece os habilitados nas configurações da clínica.
  const publicDisabledTypes = [
    clinic.consultaPresencialEnabled ? null : "PRESENCIAL",
    clinic.consultaDomiciliarEnabled ? null : "DOMICILIAR",
    clinic.consultaTeleconsultaEnabled ? null : "TELECONSULTA",
  ].filter(
    (value): value is "PRESENCIAL" | "DOMICILIAR" | "TELECONSULTA" =>
      value !== null
  )

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
        publicDisabledTypes={publicDisabledTypes}
      />
    </div>
  )
}
