"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  deleteException,
  saveAppointmentSettings,
  saveAvailabilityRules,
  saveExtraSlot,
  toggleDayBlock,
  type AgendaActionState,
} from "@/lib/actions/agenda-admin"

const WEEKDAY_NAMES = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
]

const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]

const MONTH_NAMES = [
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

export type InitialRule = {
  weekday: number
  doctorId: string | null
  startTime: string
  endTime: string
  slotDurationMin: number
  bufferMin: number
  active: boolean
}

export type InitialException = {
  id: string
  date: string // yyyy-mm-dd
  type: "BLOQUEADO" | "LIVRE"
  startTime: string | null
  endTime: string | null
}

export type InitialSettings = {
  minAdvanceHours: number
  maxAdvanceDays: number
  cancelLimitHours: number
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`
}

type IntervalRow = { start: string; end: string }

/**
 * Grade semanal com múltiplos intervalos por dia: cada dia lista seus
 * intervalos (Início/Fim) e tem um botão "+" para adicionar outro.
 * Intervalos extras podem ser removidos (mantém sempre ao menos um).
 * O componente remonta quando o médico da grade muda (key no formulário).
 */
function WeeklyGrid({ rules }: { rules: InitialRule[] }) {
  const [intervals, setIntervals] = useState<Record<number, IntervalRow[]>>(
    () => {
      const map: Record<number, IntervalRow[]> = {}
      for (let weekday = 0; weekday < 7; weekday++) {
        const dayRules = rules
          .filter((r) => r.weekday === weekday)
          .sort((a, b) => a.startTime.localeCompare(b.startTime))
        map[weekday] =
          dayRules.length > 0
            ? dayRules.map((r) => ({ start: r.startTime, end: r.endTime }))
            : [{ start: "08:00", end: "17:00" }]
      }
      return map
    }
  )

  const hasRule = (weekday: number) =>
    rules.some((r) => r.weekday === weekday && r.active)

  function addInterval(weekday: number) {
    setIntervals((prev) => ({
      ...prev,
      [weekday]: [...(prev[weekday] ?? []), { start: "12:00", end: "14:00" }],
    }))
  }

  function removeInterval(weekday: number, idx: number) {
    setIntervals((prev) => {
      const list = prev[weekday] ?? []
      if (list.length <= 1) return prev
      return { ...prev, [weekday]: list.filter((_, i) => i !== idx) }
    })
  }

  function updateInterval(
    weekday: number,
    idx: number,
    field: "start" | "end",
    value: string
  ) {
    setIntervals((prev) => ({
      ...prev,
      [weekday]: (prev[weekday] ?? []).map((row, i) =>
        i === idx ? { ...row, [field]: value } : row
      ),
    }))
  }

  return (
    <div className="flex flex-col gap-3">
      {WEEKDAY_NAMES.map((label, weekday) => {
        const dayIntervals = intervals[weekday] ?? []
        return (
          <div
            key={weekday}
            className="flex flex-col gap-2 rounded-md border px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  name={`wd_${weekday}_active`}
                  defaultChecked={hasRule(weekday)}
                  className="h-5 w-5 accent-primary"
                />
                {label}
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => addInterval(weekday)}
                title={`Adicionar outro intervalo em ${label}`}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {dayIntervals.length > 1 && (
              <div className="grid grid-cols-[1fr_1fr_2.25rem] items-center gap-2 text-xs font-medium text-muted-foreground">
                <span>Início</span>
                <span>Fim</span>
                <span />
              </div>
            )}
            {dayIntervals.map((row, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1fr_1fr_2.25rem] items-center gap-2"
              >
                <Input
                  type="time"
                  name={`wd_${weekday}_${idx}_start`}
                  value={row.start}
                  onChange={(event) =>
                    updateInterval(weekday, idx, "start", event.target.value)
                  }
                  className="h-10"
                  aria-label={`${label} início`}
                />
                <Input
                  type="time"
                  name={`wd_${weekday}_${idx}_end`}
                  value={row.end}
                  onChange={(event) =>
                    updateInterval(weekday, idx, "end", event.target.value)
                  }
                  className="h-10"
                  aria-label={`${label} fim`}
                />
                {dayIntervals.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeInterval(weekday, idx)}
                    title="Remover intervalo"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Configuração da agenda: grade semanal (por médico ou geral), exceções
 * por data (mini-calendário) e regras gerais de agendamento.
 * ADMIN escolhe a grade que edita; MEDICO só enxerga a própria.
 */
export function DisponibilidadeForm({
  rules,
  settings,
  exceptions,
  doctors,
  initialDoctorId,
  canPickDoctor,
}: {
  rules: InitialRule[]
  settings: InitialSettings
  exceptions: InitialException[]
  doctors: { id: string; name: string }[]
  /** "" = grade geral; id do médico para grade própria. */
  initialDoctorId: string
  canPickDoctor: boolean
}) {
  const router = useRouter()
  const [monthOffset, setMonthOffset] = useState(0)
  const [blockingDay, setBlockingDay] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [doctorId, setDoctorId] = useState(initialDoctorId)

  // Regras visíveis da grade selecionada (geral ou do médico)
  const visibleRules = rules.filter(
    (r) => (r.doctorId ?? null) === (doctorId || null)
  )

  const [rulesState, rulesAction, rulesPending] = useActionState<
    AgendaActionState | null,
    FormData
  >(saveAvailabilityRules, null)

  const [extraState, extraAction, extraPending] = useActionState<
    AgendaActionState | null,
    FormData
  >(saveExtraSlot, null)

  const [settingsState, settingsAction, settingsPending] = useActionState<
    AgendaActionState | null,
    FormData
  >(saveAppointmentSettings, null)

  useEffect(() => {
    if (rulesState) {
      if (rulesState.success) toast.success(rulesState.message)
      else toast.error(rulesState.message)
    }
  }, [rulesState])

  useEffect(() => {
    if (extraState) {
      if (extraState.success) toast.success(extraState.message)
      else toast.error(extraState.message)
    }
  }, [extraState])

  useEffect(() => {
    if (settingsState) {
      if (settingsState.success) toast.success(settingsState.message)
      else toast.error(settingsState.message)
    }
  }, [settingsState])

  // Mini-calendário do mês exibido
  const today = new Date()
  const month = new Date(
    today.getFullYear(),
    today.getMonth() + monthOffset,
    1
  )
  const daysInMonth = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0
  ).getDate()
  const firstWeekday = month.getDay()
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const wholeBlocked = new Set(
    exceptions
      .filter((e) => e.type === "BLOQUEADO" && !e.startTime)
      .map((e) => e.date)
  )
  const partialDays = new Set(
    exceptions.filter((e) => e.startTime).map((e) => e.date)
  )

  function handleToggleDay(day: number) {
    const dateKey = toDateKey(
      new Date(month.getFullYear(), month.getMonth(), day)
    )
    setBlockingDay(dateKey)
    startTransition(async () => {
      const result = await toggleDayBlock(dateKey)
      if (result.success) toast.success(result.message)
      else toast.error(result.message)
      setBlockingDay(null)
      router.refresh()
    })
  }

  function handleDeleteException(id: string) {
    setDeletingId(id)
    startTransition(async () => {
      const result = await deleteException(id)
      if (result.success) toast.success(result.message)
      else toast.error(result.message)
      setDeletingId(null)
      router.refresh()
    })
  }

  const sortedExceptions = [...exceptions].sort((a, b) =>
    a.date.localeCompare(b.date)
  )

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {/* Grade semanal */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grade semanal de atendimento</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            key={doctorId}
            action={rulesAction}
            className="flex flex-col gap-4"
          >
            <input type="hidden" name="doctorId" value={doctorId} />

            {canPickDoctor && (
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="availability-doctor"
                  className="text-sm font-medium"
                >
                  Médico da grade
                </label>
                <select
                  id="availability-doctor"
                  value={doctorId}
                  onChange={(event) => setDoctorId(event.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">
                    Grade geral (médicos sem grade própria)
                  </option>
                  {doctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  A grade geral é usada como fallback para médicos sem grade
                  própria.
                </p>
              </div>
            )}

            <WeeklyGrid rules={visibleRules} />
            <p className="text-xs text-muted-foreground">
              Cada dia pode ter vários intervalos de atendimento (ex.:
              08:00–12:00 e 14:00–18:00). Use o botão + para adicionar outro
              intervalo ao dia.
            </p>

            <div className="grid gap-4 sm:grid-cols-2 border-t pt-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="slot-duration" className="text-sm font-medium">
                  Duração da consulta (min)
                </label>
                <Input
                  id="slot-duration"
                  type="number"
                  name="slotDurationMin"
                  min={15}
                  max={240}
                  defaultValue={visibleRules[0]?.slotDurationMin ?? 60}
                  className="h-10"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="slot-buffer" className="text-sm font-medium">
                  Intervalo entre consultas (min)
                </label>
                <Input
                  id="slot-buffer"
                  type="number"
                  name="bufferMin"
                  min={0}
                  max={120}
                  defaultValue={visibleRules[0]?.bufferMin ?? 15}
                  className="h-10"
                />
              </div>
            </div>

            <Button type="submit" disabled={rulesPending} className="h-11">
              {rulesPending ? "Salvando..." : "Salvar disponibilidade"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Exceções por data */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Exceções de datas</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMonthOffset((m) => m - 1)}
              disabled={monthOffset <= -5}
              title="Mês anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <p className="text-sm font-semibold capitalize">
              {MONTH_NAMES[month.getMonth()]} de {month.getFullYear()}
            </p>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMonthOffset((m) => m + 1)}
              disabled={monthOffset >= 5}
              title="Próximo mês"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_SHORT.map((d) => (
              <span key={d} className="text-xs font-semibold text-muted-foreground">
                {d}
              </span>
            ))}
            {cells.map((day, index) => {
              if (day === null) {
                return <span key={`empty-${index}`} />
              }
              const dateKey = toDateKey(
                new Date(month.getFullYear(), month.getMonth(), day)
              )
              const blocked = wholeBlocked.has(dateKey)
              const partial = partialDays.has(dateKey)
              const isToday = dateKey === toDateKey(today)
              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => handleToggleDay(day)}
                  disabled={blockingDay === dateKey || isPending}
                  title={
                    blocked
                      ? "Dia bloqueado — clique para desbloquear"
                      : "Clique para bloquear o dia"
                  }
                  className={cn(
                    "flex h-10 flex-col items-center justify-center rounded-md border text-sm transition-colors",
                    blocked
                      ? "border-destructive bg-destructive/15 font-semibold text-destructive"
                      : "border-transparent hover:bg-muted",
                    partial && !blocked && "bg-amber-500/15",
                    isToday && "ring-2 ring-primary"
                  )}
                >
                  {blockingDay === dateKey ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    day
                  )}
                </button>
              )
            })}
          </div>

          <p className="text-xs text-muted-foreground">
            Clique em um dia para bloquear ou desbloquear. Dias em vermelho
            estão bloqueados; em amarelo têm bloqueio/liberação parcial.
          </p>

          {/* Liberar faixa extra */}
          <form action={extraAction} className="flex flex-col gap-3 border-t pt-4">
            <p className="text-sm font-semibold">
              Liberar faixa extra em uma data
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                type="date"
                name="date"
                defaultValue={toDateKey(today)}
                className="h-10"
              />
              <Input type="time" name="startTime" defaultValue="08:00" className="h-10" />
              <Input type="time" name="endTime" defaultValue="12:00" className="h-10" />
            </div>
            <Button
              type="submit"
              variant="outline"
              disabled={extraPending}
              className="h-10"
            >
              <Plus className="h-4 w-4" />
              {extraPending ? "Liberando..." : "Liberar faixa"}
            </Button>
          </form>

          {/* Lista de exceções */}
          {sortedExceptions.length > 0 && (
            <div className="flex flex-col gap-2 border-t pt-4">
              <p className="text-sm font-semibold">Exceções cadastradas</p>
              {sortedExceptions.map((ex) => (
                <div
                  key={ex.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <Badge
                      variant={ex.type === "BLOQUEADO" ? "destructive" : "default"}
                    >
                      {ex.type === "BLOQUEADO" ? "Bloqueado" : "Livre"}
                    </Badge>
                    <span className="text-muted-foreground">
                      {ex.date.split("-").reverse().join("/")}
                      {ex.startTime
                        ? ` (${ex.startTime}–${ex.endTime})`
                        : " (dia inteiro)"}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteException(ex.id)}
                    disabled={deletingId === ex.id}
                    title="Remover exceção"
                  >
                    {deletingId === ex.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Regras gerais */}
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Regras gerais de agendamento</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={settingsAction} className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="min-advance" className="text-sm font-medium">
                Aviso mínimo (horas antes)
              </label>
              <Input
                id="min-advance"
                type="number"
                name="minAdvanceHours"
                min={0}
                max={72}
                defaultValue={settings.minAdvanceHours}
                className="h-10"
              />
              <p className="text-xs text-muted-foreground">
                Paciente não agenda com menos de X horas de antecedência.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="max-advance" className="text-sm font-medium">
                Horizonte de agendamento (dias)
              </label>
              <Input
                id="max-advance"
                type="number"
                name="maxAdvanceDays"
                min={1}
                max={365}
                defaultValue={settings.maxAdvanceDays}
                className="h-10"
              />
              <p className="text-xs text-muted-foreground">
                Quantos dias à frente o paciente pode agendar.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="cancel-limit" className="text-sm font-medium">
                Cancelamento pelo paciente (horas antes)
              </label>
              <Input
                id="cancel-limit"
                type="number"
                name="cancelLimitHours"
                min={0}
                max={168}
                defaultValue={settings.cancelLimitHours}
                className="h-10"
              />
              <p className="text-xs text-muted-foreground">
                Com menos de X horas, o cancelamento fica com a clínica.
              </p>
            </div>
            <Button
              type="submit"
              disabled={settingsPending}
              className="h-11 sm:col-span-3"
            >
              {settingsPending ? "Salvando..." : "Salvar regras de agendamento"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
