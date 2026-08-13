/**
 * AgendaService: carrega do banco as regras de disponibilidade, exceções,
 * configurações e atendimentos ocupados, e devolve os slots livres usando
 * o gerador puro de lib/agenda/slots.ts.
 */
import { prisma } from "@/lib/prisma"
import {
  generateSlots,
  type AppointmentConfigInput,
  type AvailabilityExceptionInput,
  type AvailabilityRuleInput,
} from "./slots"

export type AgendaSettings = {
  minAdvanceHours: number
  maxAdvanceDays: number
  cancelLimitHours: number
}

export async function getAppointmentSettings(): Promise<AgendaSettings> {
  const settings = await prisma.appointmentSettings.findUnique({
    where: { id: 1 },
  })
  return {
    minAdvanceHours: settings?.minAdvanceHours ?? 2,
    maxAdvanceDays: settings?.maxAdvanceDays ?? 60,
    cancelLimitHours: settings?.cancelLimitHours ?? 12,
  }
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function endOfDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
    0,
    0,
    -1
  )
}

/**
 * Carrega todos os dados da agenda num intervalo e devolve os slots livres.
 * `from` e `to` são datas (horas ignoradas).
 */
export async function getAvailableSlots(from: Date, to: Date): Promise<{
  slots: Date[]
  settings: AgendaSettings
}> {
  const [settings, rules, exceptions, attendances] = await Promise.all([
    getAppointmentSettings(),
    prisma.availabilityRule.findMany(),
    prisma.availabilityException.findMany({
      where: { date: { gte: startOfDay(from), lte: endOfDay(to) } },
    }),
    prisma.attendance.findMany({
      where: {
        status: { not: "CANCELADO" },
        scheduledAt: { gte: startOfDay(from), lte: endOfDay(to) },
      },
      select: { scheduledAt: true },
    }),
  ])

  const config: AppointmentConfigInput = {
    minAdvanceHours: settings.minAdvanceHours,
    maxAdvanceDays: settings.maxAdvanceDays,
  }

  const ruleInputs: AvailabilityRuleInput[] = rules.map((r) => ({
    weekday: r.weekday,
    startTime: r.startTime,
    endTime: r.endTime,
    slotDurationMin: r.slotDurationMin,
    bufferMin: r.bufferMin,
    active: r.active,
  }))

  const exceptionInputs: AvailabilityExceptionInput[] = exceptions.map((e) => ({
    // Colunas @db.Date voltam como meia-noite UTC: converte p/ meia-noite local
    date: new Date(e.date.getUTCFullYear(), e.date.getUTCMonth(), e.date.getUTCDate()),
    type: e.type,
    startTime: e.startTime,
    endTime: e.endTime,
  }))

  const slots = generateSlots({
    rules: ruleInputs,
    exceptions: exceptionInputs,
    config,
    occupied: attendances.map((a) => a.scheduledAt),
    from: startOfDay(from),
    to: endOfDay(to),
  })

  return { slots, settings }
}

/** Verifica se um horário específico está livre (usado na confirmação). */
export async function isSlotFree(scheduledAt: Date): Promise<boolean> {
  const day = startOfDay(scheduledAt)
  const { slots } = await getAvailableSlots(day, day)
  return slots.some((s) => s.getTime() === scheduledAt.getTime())
}
