import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeft, ChevronRight, MapPinned } from "lucide-react"
import {
  addDays,
  endOfDay,
  format,
  isSameDay,
  isValid,
  parse,
  startOfDay,
} from "date-fns"
import { ptBR } from "date-fns/locale"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { listActiveDoctors } from "@/lib/doctor"
import { buildAddress } from "@/lib/geo"
import { Button } from "@/components/ui/button"
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

export default async function AtendimentosDoDiaPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; medico?: string }>
}) {
  const authed = requireRole(await auth(), ["ADMIN", "MEDICO"])

  const { date: dateParam, medico: medicoParam } = await searchParams

  // Dia selecionado (padrão: hoje). A navegação usa ?date=yyyy-MM-dd.
  const today = startOfDay(new Date())
  const parsedDate = dateParam ? parse(dateParam, "yyyy-MM-dd", new Date()) : null
  const selectedDay = parsedDate && isValid(parsedDate) ? parsedDate : today
  const isToday = isSameDay(selectedDay, today)

  // Somente os atendimentos do dia selecionado. Atrasados de dias
  // anteriores continuam visíveis navegando para o dia deles.
  const doctors = await listActiveDoctors()

  // Filtro por médico: MEDICO vê apenas os próprios atendimentos;
  // ADMIN filtra opcionalmente ou vê todos com o nome do médico no cartão.
  const selectedDoctorId =
    authed.user.role === "MEDICO"
      ? authed.user.id
      : doctors.some((doctor) => doctor.id === medicoParam)
        ? (medicoParam ?? null)
        : null

  const attendances = await prisma.attendance.findMany({
    where: {
      status: { in: ["AGENDADO", "EM_ATENDIMENTO", "REALIZADO"] },
      ...(selectedDoctorId ? { doctorId: selectedDoctorId } : {}),
      scheduledAt: {
        gte: startOfDay(selectedDay),
        lte: endOfDay(selectedDay),
      },
    },
    include: {
      doctor: { select: { name: true } },
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
      status: attendance.status as "AGENDADO" | "EM_ATENDIMENTO" | "REALIZADO",
      scheduledAt: attendance.scheduledAt.toISOString(),
      startedAt: attendance.startedAt?.toISOString() ?? null,
      type: attendance.type,
      patientId: patient.id,
      patientName: patient.name,
      doctorName: attendance.doctor?.name ?? null,
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

  const prevDate = addDays(selectedDay, -1)
  const nextDate = addDays(selectedDay, 1)
  const medicoQuery =
    authed.user.role === "ADMIN" && medicoParam ? `&medico=${medicoParam}` : ""
  const dayLabel = format(
    selectedDay,
    selectedDay.getFullYear() === today.getFullYear()
      ? "EEEE, d 'de' MMMM"
      : "EEEE, d 'de' MMMM 'de' yyyy",
    { locale: ptBR }
  )
  const pendingCount = cards.filter((card) => card.status !== "REALIZADO").length

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Atendimentos do dia
          </h1>
          <p className="text-muted-foreground">
            {cards.length === 0
              ? `Nenhum atendimento ${
                  isToday
                    ? "para hoje"
                    : `em ${format(selectedDay, "dd/MM/yyyy")}`
                }`
              : isToday
                ? `${pendingCount} ${
                    pendingCount === 1
                      ? "atendimento pendente"
                      : "atendimentos pendentes"
                  } — toque em "Iniciar atendimento" para avisar o paciente`
                : `${cards.length} ${
                    cards.length === 1 ? "atendimento" : "atendimentos"
                  } no dia ${format(selectedDay, "dd/MM/yyyy")}`}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Dia anterior"
            render={
              <Link
                href={`/atendimentos-do-dia?date=${format(prevDate, "yyyy-MM-dd")}${medicoQuery}`}
              />
            }
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-44 text-center text-sm font-medium capitalize">
            {dayLabel}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Próximo dia"
            render={
              <Link
                href={`/atendimentos-do-dia?date=${format(nextDate, "yyyy-MM-dd")}${medicoQuery}`}
              />
            }
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isToday && (
            <Button
              variant="ghost"
              size="sm"
              render={<Link href={`/atendimentos-do-dia${medicoQuery ? `?${medicoQuery.slice(1)}` : ""}`} />}
            >
              Hoje
            </Button>
          )}
        </div>
      </div>

      {authed.user.role === "ADMIN" && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant={!medicoParam ? "default" : "outline"}
            size="sm"
            render={
              <Link
                href={
                  dateParam
                    ? `/atendimentos-do-dia?date=${dateParam}`
                    : "/atendimentos-do-dia"
                }
              />
            }
          >
            Todos
          </Button>
          {doctors.map((doctor) => (
            <Button
              key={doctor.id}
              variant={medicoParam === doctor.id ? "default" : "outline"}
              size="sm"
              render={
                <Link
                  href={`/atendimentos-do-dia?medico=${doctor.id}${dateParam ? `&date=${dateParam}` : ""}`}
                />
              }
            >
              {doctor.name}
            </Button>
          ))}
        </div>
      )}

      {cards.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-muted-foreground">
          <MapPinned className="h-12 w-12" />
          <p className="text-sm">
            Quando houver consultas agendadas para este dia, elas aparecem aqui
            em cartões prontos para o celular.
          </p>
        </div>
      ) : (
        <DayCards attendances={cards} />
      )}
    </div>
  )
}
