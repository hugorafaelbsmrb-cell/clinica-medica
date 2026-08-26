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
 *
 * Com `doctorId`, usa a grade própria do médico (fallback para a grade
 * geral — regras com doctorId null — quando ele não tem regras) e conta
 * como ocupados apenas os atendimentos dele e os sem médico vinculado.
 * Sem `doctorId`, mantém o comportamento antigo: grade geral e todos os
 * atendimentos como ocupação.
 */
export async function getAvailableSlots(
  from: Date,
  to: Date,
  doctorId?: string | null
): Promise<{
  slots: Date[]
  settings: AgendaSettings
}> {
  let rules = await prisma.availabilityRule.findMany({
    where: doctorId ? { doctorId } : { doctorId: null },
  })
  // Médico sem grade própria usa a grade geral (regras sem médico).
  if (doctorId && rules.length === 0) {
    rules = await prisma.availabilityRule.findMany({
      where: { doctorId: null },
    })
  }

  const [settings, exceptions, attendances] = await Promise.all([
    getAppointmentSettings(),
    prisma.availabilityException.findMany({
      where: { date: { gte: startOfDay(from), lte: endOfDay(to) } },
    }),
    prisma.attendance.findMany({
      where: {
        status: { not: "CANCELADO" },
        scheduledAt: { gte: startOfDay(from), lte: endOfDay(to) },
        // Com médico, ocupam apenas os atendimentos dele e os sem médico
        // vinculado (legado); sem médico, toda ocupação conta (antigo).
        ...(doctorId ? { OR: [{ doctorId }, { doctorId: null }] } : {}),
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

/**
 * Verifica se um horário específico está livre (usado na confirmação).
 * `doctorId` opcional: valida contra a grade e a ocupação daquele médico.
 */
export async function isSlotFree(
  scheduledAt: Date,
  doctorId?: string | null
): Promise<boolean> {
  const day = startOfDay(scheduledAt)
  const { slots } = await getAvailableSlots(day, day, doctorId)
  return slots.some((s) => s.getTime() === scheduledAt.getTime())
}
