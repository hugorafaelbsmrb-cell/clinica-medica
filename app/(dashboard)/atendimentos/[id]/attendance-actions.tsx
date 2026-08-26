"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Banknote, CheckCircle2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  completeAttendance,
  cancelAttendance,
  confirmCashPayment,
} from "@/lib/actions/atendimentos"

export function AttendanceActions({
  attendanceId,
  status,
  paymentMethod,
  cashReceivedAt,
  value,
}: {
  attendanceId: string
  status:
    | "AGUARDANDO_PAGAMENTO"
    | "AGENDADO"
    | "EM_ATENDIMENTO"
    | "REALIZADO"
    | "CANCELADO"
  paymentMethod: string | null
  cashReceivedAt: Date | null
  value: number
}) {
  const router = useRouter()
  const [loading, setLoading] = useState<"complete" | "cancel" | "cash" | null>(
    null
  )

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

  async function handleConfirmCash() {
    setLoading("cash")
    const result = await confirmCashPayment(attendanceId)
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

  const needsCash =
    paymentMethod === "DINHEIRO" && !cashReceivedAt && value > 0

  return (
    <div className="flex flex-col gap-3">
      {paymentMethod === "DINHEIRO" && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
          <p className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
            <Banknote className="h-4 w-4 shrink-0" />
            Pagamento em dinheiro: R${value.toLocaleString("pt-BR", {
              minimumFractionDigits: 2,
            })}
          </p>
          {needsCash && (
            <Button onClick={handleConfirmCash} disabled={loading !== null}>
              {loading === "cash" ? "Confirmando..." : "Confirmar recebimento"}
            </Button>
          )}
          {cashReceivedAt && (
            <p className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Recebimento confirmado
            </p>
          )}
        </div>
      )}
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
    </div>
  )
}
