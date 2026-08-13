"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CheckCircle2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  completeAttendance,
  cancelAttendance,
} from "@/lib/actions/atendimentos"

export function AttendanceActions({
  attendanceId,
  status,
}: {
  attendanceId: string
  status: "AGENDADO" | "REALIZADO" | "CANCELADO"
}) {
  const router = useRouter()
  const [loading, setLoading] = useState<"complete" | "cancel" | null>(null)

  async function handleComplete() {
    setLoading("complete")
    const result = await completeAttendance(attendanceId)
    setLoading(null)
    if (result.success) {
      toast.success(result.message)
      router.refresh()
    } else {
      toast.error(result.message)
    }
  }

  async function handleCancel() {
    setLoading("cancel")
    const result = await cancelAttendance(attendanceId)
    setLoading(null)
    if (result.success) {
      toast.success(result.message)
      router.refresh()
    } else {
      toast.error(result.message)
    }
  }

  if (status === "REALIZADO" || status === "CANCELADO") {
    return null
  }

  return (
    <div className="flex gap-3">
      <Button onClick={handleComplete} disabled={loading !== null}>
        <CheckCircle2 className="h-4 w-4" />
        {loading === "complete" ? "Registrando..." : "Marcar como realizado"}
      </Button>
      <Button
        variant="outline"
        className="text-destructive"
        onClick={handleCancel}
        disabled={loading !== null}
      >
        <XCircle className="h-4 w-4" />
        Cancelar atendimento
      </Button>
    </div>
  )
}
