/**
 * Gerador puro de slots livres da agenda.
 *
 * Não acessa o banco: recebe regras, exceções e horários já ocupados e
 * devolve os horários livres. É usado tanto no painel do admin (página
 * /agenda) quanto no fluxo público (/cadastro), garantindo que ambos
 * mostrem exatamente os mesmos horários.
 */

export type AvailabilityRuleInput = {
  weekday: number // 0 = domingo ... 6 = sábado
  startTime: string // "08:00"
  endTime: string // "17:30"
  slotDurationMin: number
  bufferMin: number
  active: boolean
}

export type AvailabilityExceptionInput = {
  date: Date // só o dia importa
  type: "BLOQUEADO" | "LIVRE"
  startTime: string | null
  endTime: string | null
}

export type AppointmentConfigInput = {
  minAdvanceHours: number
  maxAdvanceDays: number
}

/** Faixa padrão usada quando uma exceção LIVRE não informa horários. */
const DEFAULT_RANGE = { start: 8 * 60, end: 17 * 60 } // 08:00–17:00

export function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null
  const [h, m] = time.split(":").map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * Lista os horários livres entre `from` e `to` (inclusive), já filtrando:
 * - dias sem regra ativa;
 * - faixas bloqueadas por exceções;
 * - slots que começam antes do aviso mínimo (minAdvanceHours);
 * - slots em conflito com horários já ocupados (atendimentos não cancelados).
 */
export function generateSlots(params: {
  rules: AvailabilityRuleInput[]
  exceptions: AvailabilityExceptionInput[]
  config: AppointmentConfigInput
  occupied: Date[]
  from: Date
  to: Date
  now?: Date
}): Date[] {
  const now = params.now ?? new Date()
  const minTime = now.getTime() + params.config.minAdvanceHours * 60 * 60 * 1000

  const result: Date[] = []
  const seen = new Set<number>()

  const day = new Date(
    params.from.getFullYear(),
    params.from.getMonth(),
    params.from.getDate()
  )
  const last = new Date(
    params.to.getFullYear(),
    params.to.getMonth(),
    params.to.getDate()
  )

  for (; day <= last; day.setDate(day.getDate() + 1)) {
    const weekday = day.getDay()
    const rule = params.rules.find((r) => r.active && r.weekday === weekday)
    const dayExceptions = params.exceptions.filter((e) => sameDay(e.date, day))

    // Sem regra ativa, o dia só existe se tiver faixa extra liberada
    const hasExtra = dayExceptions.some((e) => e.type === "LIVRE")
    if (!rule && !hasExtra) continue

    let fullBlocked = false
    const blockedRanges: { start: number; end: number }[] = []
    const extraRanges: { start: number; end: number }[] = []

    for (const ex of dayExceptions) {
      const s = timeToMinutes(ex.startTime)
      const e = timeToMinutes(ex.endTime)
      if (ex.type === "BLOQUEADO") {
        // BLOQUEADO sem faixa = dia inteiro fechado
        if (s === null || e === null) fullBlocked = true
        else blockedRanges.push({ start: s, end: e })
      } else if (s !== null && e !== null) {
        extraRanges.push({ start: s, end: e })
      } else {
        // LIVRE sem faixa = libera o dia inteiro no horário padrão
        extraRanges.push({ start: DEFAULT_RANGE.start, end: DEFAULT_RANGE.end })
      }
    }

    if (fullBlocked) continue

    const ruleStart = timeToMinutes(rule?.startTime) ?? DEFAULT_RANGE.start
    const ruleEnd = timeToMinutes(rule?.endTime) ?? DEFAULT_RANGE.end
    const duration = rule?.slotDurationMin ?? 60
    const buffer = rule?.bufferMin ?? 15

    // Intervalos permitidos: regra do dia - bloqueios + faixas extras
    const ranges: { start: number; end: number }[] = rule
      ? [{ start: ruleStart, end: ruleEnd }]
      : []
    for (const b of blockedRanges) {
      const next: { start: number; end: number }[] = []
      for (const r of ranges) {
        if (b.end <= r.start || b.start >= r.end) {
          next.push(r)
          continue
        }
        if (b.start > r.start) next.push({ start: r.start, end: b.start })
        if (b.end < r.end) next.push({ start: b.end, end: r.end })
      }
      ranges.length = 0
      ranges.push(...next)
    }
    ranges.push(...extraRanges)

    // Gera os slots de cada intervalo permitido
    for (const range of ranges) {
      for (
        let start = range.start;
        start + duration <= range.end;
        start += duration + buffer
      ) {
        const slot = new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          0,
          start
        )
        if (slot.getTime() < minTime) continue

        // Conflito: atendimento ocupando o slot ou o intervalo de folga
        const slotEnd = slot.getTime() + (duration + buffer) * 60 * 1000
        const conflict = params.occupied.some((o) => {
          const t = o.getTime()
          return t >= slot.getTime() && t < slotEnd
        })
        if (conflict) continue

        if (seen.has(slot.getTime())) continue
        seen.add(slot.getTime())
        result.push(slot)
      }
    }
  }

  return result.sort((a, b) => a.getTime() - b.getTime())
}

export type DaySlots = { date: Date; slots: Date[] }

/** Agrupa slots por dia, na ordem cronológica. */
export function groupSlotsByDay(slots: Date[]): DaySlots[] {
  const map = new Map<string, DaySlots>()
  for (const slot of slots) {
    const key = `${slot.getFullYear()}-${slot.getMonth()}-${slot.getDate()}`
    let entry = map.get(key)
    if (!entry) {
      entry = { date: slot, slots: [] }
      map.set(key, entry)
    }
    entry.slots.push(slot)
  }
  return [...map.values()]
}
