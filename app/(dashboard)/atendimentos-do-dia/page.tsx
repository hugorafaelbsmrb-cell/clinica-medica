import type { Metadata } from "next"
import { MapPinned } from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { buildAddress } from "@/lib/geo"
import {
  DayCards,
  type DayCardData,
} from "@/components/atendimentos-do-dia/day-cards"

export const metadata: Metadata = { title: "Atendimentos do dia" }

/** Idade a partir da data de nascimento. */
function ageFrom(birthDate: Date | null): number | null {
  if (!birthDate) return null
  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }
  return age
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

export default async function AtendimentosDoDiaPage() {
  const session = await auth()
  requireRole(session, ["ADMIN", "MEDICO"])

  const now = new Date()
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)

  // Agendados e em atendimento de hoje (incluindo atrasados de dias
  // anteriores que ainda não foram finalizados).
  const attendances = await prisma.attendance.findMany({
    where: {
      status: { in: ["AGENDADO", "EM_ATENDIMENTO"] },
      scheduledAt: { lte: endOfToday },
    },
    include: {
      patient: {
        include: {
          prescriptions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { items: true },
          },
          plans: {
            where: { status: "APROVADO" },
            orderBy: { updatedAt: "desc" },
            take: 1,
          },
        },
      },
    },
    orderBy: { scheduledAt: "asc" },
  })

  const cards: DayCardData[] = attendances.map((attendance) => {
    const patient = attendance.patient
    // Endereço do atendimento tem prioridade: o agendamento pode ser
    // em outro local diferente do cadastro do paciente.
    const address =
      attendance.homeAddress ||
      buildAddress({
        street: patient.street,
        number: patient.number,
        neighborhood: patient.neighborhood,
        city: patient.city,
        state: patient.state,
      }) ||
      "Endereço não informado"

    const lastPrescription = patient.prescriptions[0]
    const medications = (lastPrescription?.items ?? [])
      .slice(0, 4)
      .map((item) =>
        [item.medication, item.dosage, item.frequency]
          .filter(Boolean)
          .join(" — ")
      )

    const currentPlan = patient.plans[0] ?? null

    return {
      id: attendance.id,
      status: attendance.status as "AGENDADO" | "EM_ATENDIMENTO",
      scheduledAt: attendance.scheduledAt.toISOString(),
      startedAt: attendance.startedAt?.toISOString() ?? null,
      type: attendance.type,
      patientId: patient.id,
      patientName: patient.name,
      age: ageFrom(patient.birthDate),
      reason: attendance.slotNote ?? patient.consultationReason,
      address,
      phone: patient.phone,
      // Coordenadas do atendimento (GPS no local) têm prioridade
      // sobre as do cadastro do paciente.
      latitude: attendance.latitude ?? patient.latitude,
      longitude: attendance.longitude ?? patient.longitude,
      medications,
      planDiagnosis: currentPlan ? truncate(currentPlan.diagnosis, 160) : null,
      planSummary: currentPlan?.summary ? truncate(currentPlan.summary, 200) : null,
    }
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Atendimentos do dia
        </h1>
        <p className="text-muted-foreground">
          {cards.length === 0
            ? "Nenhum atendimento pendente para hoje"
            : `${cards.length} ${
                cards.length === 1 ? "atendimento pendente" : "atendimentos pendentes"
              } — toque em "Iniciar atendimento" para avisar o paciente`}
        </p>
      </div>

      {cards.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-muted-foreground">
          <MapPinned className="h-12 w-12" />
          <p className="text-sm">
            Quando houver consultas agendadas para hoje, elas aparecem aqui em
            cartões prontos para o celular.
          </p>
        </div>
      ) : (
        <DayCards attendances={cards} />
      )}
    </div>
  )
}
