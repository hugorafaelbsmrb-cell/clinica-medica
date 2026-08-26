import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { listActiveDoctors } from "@/lib/doctor"
import { PatientForm } from "@/components/pacientes/paciente-form"

export const metadata: Metadata = { title: "Editar paciente" }

export default async function EditarPacientePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = requireRole(await auth(), ["ADMIN", "MEDICO", "SECRETARIA"])

  const { id } = await params
  const [patient, doctors] = await Promise.all([
    prisma.patient.findUnique({ where: { id } }),
    listActiveDoctors(),
  ])

  if (!patient) notFound()

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Editar paciente</h1>
        <p className="text-muted-foreground">{patient.name}</p>
      </div>
      <PatientForm
        patient={{
          id: patient.id,
          name: patient.name,
          cpf: patient.cpf,
          birthDate: patient.birthDate?.toISOString() ?? null,
          phone: patient.phone,
          email: patient.email,
          street: patient.street,
          number: patient.number,
          complement: patient.complement,
          neighborhood: patient.neighborhood,
          city: patient.city,
          state: patient.state,
          zipCode: patient.zipCode,
          insurance: patient.insurance,
          notes: patient.notes,
          consultationReason: patient.consultationReason,
          doctorId: patient.doctorId,
          latitude: patient.latitude,
          longitude: patient.longitude,
          locationSource: patient.locationSource,
          lgpdConsent: patient.lgpdConsent,
          whatsappEnabled: patient.whatsappEnabled,
        }}
        doctors={doctors}
        isAdmin={session.user.role === "ADMIN"}
      />
    </div>
  )
}
