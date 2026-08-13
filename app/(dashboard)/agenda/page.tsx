import Link from "next/link"
import type { Metadata } from "next"
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { Button } from "@/components/ui/button"
import { generateSlots } from "@/lib/agenda/slots"
import {
  AgendaSemana,
  type WeekDayData,
} from "@/components/agenda/agenda-semana"
import {
  DisponibilidadeForm,
  type InitialException,
  type InitialRule,
  type InitialSettings,
} from "@/components/agenda/disponibilidade-form"

export const metadata: Metadata = { title: "Agenda" }

const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"]

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Colunas @db.Date voltam como meia-noite UTC: usa getters UTC p/ a chave. */
function dbDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function mondayOf(date: Date): Date {
  const dow = date.getDay() // 0 = domingo
  const diff = dow === 0 ? -6 : 1 - dow
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + diff)
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ semana?: string }>
}) {
  const session = await auth()
  const authed = requireRole(session, ["ADMIN", "MEDICO", "SECRETARIA"])
  const canEdit =
    authed.user.role === "ADMIN" || authed.user.role === "MEDICO"

  const { semana } = await searchParams

  const today = new Date()
  let weekStart = mondayOf(today)
  if (semana && /^\d{4}-\d{2}-\d{2}$/.test(semana)) {
    const parsed = new Date(`${semana}T12:00:00`)
    if (!Number.isNaN(parsed.getTime())) {
      weekStart = mondayOf(parsed)
    }
  }
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)

  const formWindowStart = new Date(today)
  formWindowStart.setDate(formWindowStart.getDate() - 180)
  const formWindowEnd = new Date(today)
  formWindowEnd.setDate(formWindowEnd.getDate() + 180)

  const [rules, exceptions, settings, attendances] = await Promise.all([
    prisma.availabilityRule.findMany(),
    prisma.availabilityException.findMany({
      where: { date: { gte: formWindowStart, lte: formWindowEnd } },
      orderBy: { date: "asc" },
    }),
    prisma.appointmentSettings.findUnique({ where: { id: 1 } }),
    prisma.attendance.findMany({
      where: {
        status: { not: "CANCELADO" },
        scheduledAt: { gte: weekStart, lte: weekEnd },
      },
      include: { patient: { select: { name: true, consultationReason: true } } },
    }),
  ])

  // Dados da semana: slots por dia (visão do admin ignora o aviso mínimo)
  const days: WeekDayData[] = []
  for (let i = 0; i < 7; i++) {
    const day = new Date(
      weekStart.getFullYear(),
      weekStart.getMonth(),
      weekStart.getDate() + i
    )
    const dateKey = toDateKey(day)

    const dayExceptions = exceptions.filter(
      (e) => dbDateKey(e.date) === dateKey
    )
    const blockedAllDay = dayExceptions.some(
      (e) => e.type === "BLOQUEADO" && !e.startTime
    )

    const dayRule = rules.find(
      (r) => r.active && r.weekday === day.getDay()
    )
    const duration = dayRule?.slotDurationMin ?? 60

    const slots = generateSlots({
      rules: rules.map((r) => ({
        weekday: r.weekday,
        startTime: r.startTime,
        endTime: r.endTime,
        slotDurationMin: r.slotDurationMin,
        bufferMin: r.bufferMin,
        active: r.active,
      })),
      exceptions: dayExceptions.map((e) => ({
        date: new Date(
          e.date.getUTCFullYear(),
          e.date.getUTCMonth(),
          e.date.getUTCDate()
        ),
        type: e.type,
        startTime: e.startTime,
        endTime: e.endTime,
      })),
      config: { minAdvanceHours: 0, maxAdvanceDays: 0 },
      occupied: attendances.map((a) => a.scheduledAt),
      from: day,
      to: day,
      now: new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate()
      ),
    })

    days.push({
      date: dateKey,
      label: `${WEEKDAY_SHORT[day.getDay()]} ${day.getDate()}/${pad(
        day.getMonth() + 1
      )}`,
      today: dateKey === toDateKey(today),
      blockedAllDay,
      slots: slots.map((slot) => {
        const attendance =
          attendances.find(
            (a) => a.scheduledAt.getTime() === slot.getTime()
          ) ?? null
        const end = new Date(slot.getTime() + duration * 60 * 1000)
        return {
          time: `${pad(slot.getHours())}:${pad(slot.getMinutes())}`,
          endTime: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
          attendance: attendance
            ? {
                id: attendance.id,
                patientName: attendance.patient.name,
                reason:
                  attendance.slotNote ??
                  attendance.patient.consultationReason,
              }
            : null,
        }
      }),
    })
  }

  const prevWeek = new Date(weekStart)
  prevWeek.setDate(prevWeek.getDate() - 7)
  const nextWeek = new Date(weekStart)
  nextWeek.setDate(nextWeek.getDate() + 7)

  const initialRules: InitialRule[] = rules.map((r) => ({
    weekday: r.weekday,
    startTime: r.startTime,
    endTime: r.endTime,
    slotDurationMin: r.slotDurationMin,
    bufferMin: r.bufferMin,
    active: r.active,
  }))

  const initialExceptions: InitialException[] = exceptions.map((e) => ({
    id: e.id,
    date: dbDateKey(e.date),
    type: e.type,
    startTime: e.startTime,
    endTime: e.endTime,
  }))

  const initialSettings: InitialSettings = {
    minAdvanceHours: settings?.minAdvanceHours ?? 2,
    maxAdvanceDays: settings?.maxAdvanceDays ?? 60,
    cancelLimitHours: settings?.cancelLimitHours ?? 12,
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
          <p className="text-muted-foreground">
            Disponibilidade da clínica e consultas agendadas
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              render={
                <Link href={`/agenda?semana=${toDateKey(prevWeek)}`} />
              }
              title="Semana anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-32 text-center text-sm font-medium">
              Semana de {pad(weekStart.getDate())}/{pad(weekStart.getMonth() + 1)}
            </span>
            <Button
              variant="outline"
              size="icon"
              render={<Link href={`/agenda?semana=${toDateKey(nextWeek)}`} />}
              title="Próxima semana"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button render={<Link href="/atendimentos/novo" />}>
            <Plus className="h-4 w-4" />
            Novo atendimento
          </Button>
        </div>
      </div>

      {canEdit ? (
        <DisponibilidadeForm
          rules={initialRules}
          settings={initialSettings}
          exceptions={initialExceptions}
        />
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="h-4 w-4" />
          A disponibilidade é configurada por administradores e médicos.
        </p>
      )}

      <AgendaSemana days={days} canEdit={canEdit} />
    </div>
  )
}
