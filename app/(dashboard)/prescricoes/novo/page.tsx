import type { Metadata } from "next"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { PrescriptionForm } from "@/components/prescricoes/prescricao-form"

export const metadata: Metadata = { title: "Nova prescrição" }

export default async function NovaPrescricaoPage({
  searchParams,
}: {
  searchParams: Promise<{ atendimento?: string }>
}) {
  const session = await auth()
  requireRole(session, ["ADMIN", "MEDICO"])

  const { atendimento } = await searchParams

  const [patients, attendances] = await Promise.all([
    prisma.patient.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.attendance.findMany({
      orderBy: { scheduledAt: "desc" },
      take: 100,
      include: { patient: true },
    }),
  ])

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nova prescrição</h1>
        <p className="text-muted-foreground">
          Adicione os medicamentos com dose, frequência e duração.
        </p>
      </div>
      <PrescriptionForm
        patients={patients}
        attendances={attendances.map((attendance) => ({
          id: attendance.id,
          label: `${attendance.patient.name} — ${format(
            attendance.scheduledAt,
            "dd/MM/yyyy",
            { locale: ptBR }
          )}`,
        }))}
        preselectedAttendanceId={atendimento}
      />
    </div>
  )
}
