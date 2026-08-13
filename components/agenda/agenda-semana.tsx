"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Ban, Loader2, Lock, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { blockSlot } from "@/lib/actions/agenda-admin"

export type WeekDayData = {
  date: string // yyyy-mm-dd
  label: string // "seg 12/05"
  today: boolean
  blockedAllDay: boolean
  slots: {
    time: string
    endTime: string
    attendance: {
      id: string
      patientName: string
      reason: string | null
    } | null
  }[]
}

/**
 * Visão semanal da agenda: cada coluna é um dia; os slots mostram os
 * horários livres (com ação de bloqueio) e os ocupados (paciente + motivo).
 */
export function AgendaSemana({
  days,
  canEdit,
}: {
  days: WeekDayData[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [blocking, setBlocking] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleBlockSlot(date: string, startTime: string, endTime: string) {
    const key = `${date}-${startTime}`
    setBlocking(key)
    startTransition(async () => {
      const result = await blockSlot({ date, startTime, endTime })
      if (result.success) toast.success(result.message)
      else toast.error(result.message)
      setBlocking(null)
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Visão da semana</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
          {days.map((day) => (
            <div
              key={day.date}
              className={cn(
                "flex flex-col gap-2 rounded-lg border p-2",
                day.today && "border-primary",
                day.blockedAllDay && "border-destructive/50 bg-destructive/5"
              )}
            >
              <div className="flex items-center justify-between gap-1 px-1">
                <span
                  className={cn(
                    "text-sm font-semibold capitalize",
                    day.blockedAllDay && "text-destructive"
                  )}
                >
                  {day.label}
                </span>
                {day.blockedAllDay && (
                  <Lock className="h-4 w-4 shrink-0 text-destructive" />
                )}
              </div>

              {day.blockedAllDay ? (
                <p className="px-1 pb-2 text-xs text-destructive">
                  Dia bloqueado
                </p>
              ) : day.slots.length === 0 ? (
                <p className="px-1 pb-2 text-xs text-muted-foreground">
                  Sem horários
                </p>
              ) : (
                day.slots.map((slot) => (
                  <div
                    key={slot.time}
                    className={cn(
                      "flex flex-col gap-1 rounded-md border px-2 py-1.5 text-xs",
                      slot.attendance
                        ? "border-primary/40 bg-primary/10"
                        : "border-border"
                    )}
                  >
                    <span className="font-semibold">
                      {slot.time}
                      {!slot.attendance && (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          — livre
                        </span>
                      )}
                    </span>

                    {slot.attendance ? (
                      <>
                        <span className="flex items-center gap-1 font-medium">
                          <User className="h-3 w-3 shrink-0" />
                          {slot.attendance.patientName}
                        </span>
                        {slot.attendance.reason && (
                          <span className="line-clamp-2 text-muted-foreground">
                            {slot.attendance.reason}
                          </span>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          render={
                            <Link href={`/atendimentos/${slot.attendance.id}`} />
                          }
                        >
                          Ver
                        </Button>
                      </>
                    ) : (
                      canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isPending}
                          onClick={() =>
                            handleBlockSlot(day.date, slot.time, slot.endTime)
                          }
                          className="h-7 justify-start px-1 text-xs text-muted-foreground hover:text-destructive"
                        >
                          {blocking === `${day.date}-${slot.time}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Ban className="h-3 w-3" />
                          )}
                          Bloquear
                        </Button>
                      )
                    )}
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
