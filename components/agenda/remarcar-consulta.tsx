"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  PublicDayPicker,
  type PickerDay,
} from "@/components/agenda/public-day-picker"
import {
  getPublicAgenda,
  remarcarConsultaPublica,
} from "@/lib/actions/agendamento-publico"
import {
  formatDayLabel,
  formatTimeLabel,
  parseDayDate,
} from "@/lib/agenda/week-groups"

type PickerState = "idle" | "day" | "slot" | "done"

/**
 * Fluxo de remarcação pública: escolhe novo dia, novo horário e confirma.
 * O token é o cancelToken da consulta agendada (autorização do paciente).
 */
export function RemarcarConsulta({ token }: { token: string }) {
  const router = useRouter()
  const [state, setState] = useState<PickerState>("idle")
  const [days, setDays] = useState<PickerDay[]>([])
  const [selectedDay, setSelectedDay] = useState<PickerDay | null>(null)
  const [selectedSlot, setSelectedSlot] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [loadingAgenda, startLoadingAgenda] = useTransition()
  const [pending, startConfirm] = useTransition()

  function open() {
    setError("")
    setSuccess("")
    startLoadingAgenda(async () => {
      const result = await getPublicAgenda()
      if (!result.available) {
        setError(result.message)
        return
      }
      setDays(result.days)
      setState("day")
    })
  }

  function confirm() {
    if (!selectedDay || !selectedSlot) return
    setError("")
    startConfirm(async () => {
      const result = await remarcarConsultaPublica({
        token,
        scheduledAt: selectedSlot,
      })
      if (!result.success) {
        setError(result.message)
        return
      }
      setSuccess(result.message)
      setState("done")
      router.refresh()
    })
  }

  if (state === "done") {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-emerald-500/10 px-4 py-3 text-base font-medium text-emerald-600">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
        {success}
      </p>
    )
  }

  if (state === "idle") {
    return (
      <div className="flex w-full flex-col items-center gap-3">
        {error && (
          <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-base font-medium text-destructive">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
            {error}
          </p>
        )}
        <Button
          type="button"
          onClick={open}
          disabled={loadingAgenda}
          variant="outline"
          className="h-12 w-full text-base"
        >
          {loadingAgenda ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <CalendarClock className="h-5 w-5" />
          )}
          Alterar data e horário
        </Button>
      </div>
    )
  }

  if (state === "day") {
    return (
      <div className="flex w-full flex-col gap-4">
        {error && (
          <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-base font-medium text-destructive">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
            {error}
          </p>
        )}
        <h3 className="text-lg font-semibold">Escolha o novo dia</h3>
        <PublicDayPicker
          days={days}
          onSelect={(day) => {
            setSelectedDay(day)
            setSelectedSlot("")
            setError("")
            setState("slot")
          }}
        />
        <Button
          type="button"
          variant="ghost"
          onClick={() => setState("idle")}
          className="w-full"
        >
          <ChevronLeft className="h-4 w-4" />
          Voltar
        </Button>
      </div>
    )
  }

  // state === "slot"
  const day = selectedDay!
  return (
    <div className="flex w-full flex-col gap-4">
      {error && (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-base font-medium text-destructive">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
          {error}
        </p>
      )}
      <h3 className="text-lg font-semibold capitalize">
        {formatDayLabel(parseDayDate(day.date))}
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {day.slots.map((slot) => (
          <button
            key={slot.iso}
            type="button"
            onClick={() => setSelectedSlot(slot.iso)}
            className={cn(
              "flex h-14 items-center justify-center rounded-xl border-2 border-border text-lg font-semibold transition-colors hover:border-primary hover:bg-muted",
              selectedSlot === slot.iso && "border-primary bg-primary/10"
            )}
          >
            {slot.time}
          </button>
        ))}
      </div>
      {selectedSlot && (
        <div className="flex flex-col gap-3">
          <p className="text-center text-muted-foreground">
            Nova data:{" "}
            <strong className="capitalize">
              {formatDayLabel(parseDayDate(day.date))}
            </strong>{" "}
            às <strong>{formatTimeLabel(new Date(selectedSlot))}</strong>
          </p>
          <Button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="h-12 w-full text-base"
          >
            {pending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              "Confirmar novo horário"
            )}
          </Button>
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        onClick={() => setState("day")}
        className="w-full"
      >
        <ChevronLeft className="h-4 w-4" />
        Escolher outro dia
      </Button>
    </div>
  )
}
