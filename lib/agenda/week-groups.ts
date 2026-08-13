/**
 * Utilitários puros para agrupar os dias com vagas em semanas
 * (segunda a domingo) e formatar datas em pt-BR. Compartilhados
 * pelo wizard de cadastro e pela página pública de consultas.
 * Seguro para client e server: sem dependências de ambiente.
 */

export const SHORT_WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"]

export const WEEKDAY_LABELS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
]

export const MONTH_LABELS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
]

/** Converte "yyyy-mm-dd" em Date local (sem deslocamento de fuso). */
export function parseDayDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(year, month - 1, day)
}

export type WeekGroup<T> = { label: string; days: T[] }

/** Agrupa os dias com vagas em semanas (segunda a domingo). */
export function groupAgendaByWeek<T extends { date: string }>(
  days: T[]
): WeekGroup<T>[] {
  const today = new Date()
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  )
  const byWeek = new Map<string, T[]>()

  for (const day of days) {
    const d = parseDayDate(day.date)
    const offset = (d.getDay() + 6) % 7 // segunda-feira = 0
    const start = new Date(d)
    start.setDate(d.getDate() - offset)
    const key = `${start.getFullYear()}-${String(
      start.getMonth() + 1
    ).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`
    const list = byWeek.get(key)
    if (list) list.push(day)
    else byWeek.set(key, [day])
  }

  const weeks: WeekGroup<T>[] = []
  for (const [key, weekDays] of byWeek) {
    const [year, month, day] = key.split("-").map(Number)
    const start = new Date(year, month - 1, day)
    const end = new Date(year, month - 1, day + 6)
    const diffDays = Math.round(
      (start.getTime() - todayStart.getTime()) / 86_400_000
    )

    let label: string
    if (diffDays > -7 && diffDays <= 0) label = "Esta semana"
    else if (diffDays > 0 && diffDays <= 7) label = "Próxima semana"
    else if (start.getMonth() === end.getMonth()) {
      label = `Semana de ${start.getDate()} a ${end.getDate()} de ${
        MONTH_LABELS[end.getMonth()]
      }`
    } else {
      label = `Semana de ${start.getDate()} de ${
        MONTH_LABELS[start.getMonth()]
      } a ${end.getDate()} de ${MONTH_LABELS[end.getMonth()]}`
    }
    weeks.push({ label, days: weekDays })
  }
  return weeks
}

/** "quinta-feira, 15 de maio" */
export function formatDayLabel(d: Date): string {
  return `${WEEKDAY_LABELS[d.getDay()]}, ${d.getDate()} de ${
    MONTH_LABELS[d.getMonth()]
  }`
}

/** "08:30" */
export function formatTimeLabel(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`
}
