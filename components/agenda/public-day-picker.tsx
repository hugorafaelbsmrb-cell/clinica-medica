"use client"

import { ChevronDown } from "lucide-react"
import {
  MONTH_LABELS,
  SHORT_WEEKDAY,
  groupAgendaByWeek,
  parseDayDate,
} from "@/lib/agenda/week-groups"

export type PickerDay = {
  date: string // "yyyy-mm-dd"
  label: string // "quinta-feira, 15 de maio"
  slots: { iso: string; time: string }[]
}

/**
 * Lista de dias com vagas agrupada por semana: "Esta semana" e
 * "Próxima semana" abertas, as demais recolhidas e expansíveis.
 * Compartilhado entre o wizard /cadastro e a remarcação pública.
 */
export function PublicDayPicker({
  days,
  onSelect,
}: {
  days: PickerDay[]
  onSelect: (day: PickerDay) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      {groupAgendaByWeek(days).map((week, weekIndex) => {
        const daysGrid = (
          <div className="grid grid-cols-2 gap-2">
            {week.days.map((day) => {
              const d = parseDayDate(day.date)
              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => onSelect(day)}
                  className="flex flex-col items-center gap-1 rounded-xl border-2 border-border px-2 py-3 transition-colors hover:border-primary hover:bg-muted"
                >
                  <span className="text-xs font-medium uppercase text-muted-foreground">
                    {SHORT_WEEKDAY[d.getDay()]}
                  </span>
                  <span className="text-2xl font-bold leading-none">
                    {d.getDate()}
                    <span className="ml-1 text-sm font-medium text-muted-foreground">
                      {MONTH_LABELS[d.getMonth()].slice(0, 3)}
                    </span>
                  </span>
                  <span className="mt-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                    {day.slots.length}{" "}
                    {day.slots.length === 1 ? "vaga" : "vagas"}
                  </span>
                </button>
              )
            })}
          </div>
        )

        if (weekIndex < 2) {
          return (
            <section key={week.label} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {week.label}
              </h3>
              {daysGrid}
            </section>
          )
        }
        return (
          <details key={week.label} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl border-2 border-border px-4 py-3 text-sm font-semibold text-muted-foreground [&::-webkit-details-marker]:hidden">
              <span>{week.label}</span>
              <span className="flex items-center gap-1 text-primary">
                {week.days.length} {week.days.length === 1 ? "dia" : "dias"}
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="pt-2">{daysGrid}</div>
          </details>
        )
      })}
    </div>
  )
}
