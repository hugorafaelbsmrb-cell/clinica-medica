"use client"

import { useState, useTransition } from "react"
import { CheckCircle2, Loader2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cancelarConsultaPublica } from "@/lib/actions/agendamento-publico"

/**
 * Botão de cancelamento público: chama a action e mostra o resultado
 * (sucesso, já cancelada ou recusa por estar muito próximo da consulta).
 */
export function CancelarConsultaButton({ token }: { token: string }) {
  const [result, setResult] = useState<{
    success: boolean
    message: string
  } | null>(null)
  const [pending, startTransition] = useTransition()

  function handleCancel() {
    startTransition(async () => {
      const response = await cancelarConsultaPublica(token)
      setResult({ success: response.success, message: response.message })
    })
  }

  if (result?.success) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-4 py-3 text-base font-medium text-emerald-600">
        <CheckCircle2 className="h-5 w-5 shrink-0" />
        {result.message}
      </p>
    )
  }

  return (
    <div className="flex w-full flex-col items-center gap-3">
      {result && !result.success && (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-base font-medium text-destructive">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
          {result.message}
        </p>
      )}
      {!result && (
        <Button
          onClick={handleCancel}
          disabled={pending}
          variant="destructive"
          className="h-12 w-full text-base"
        >
          {pending ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Cancelando...
            </>
          ) : (
            "Cancelar esta consulta"
          )}
        </Button>
      )}
    </div>
  )
}
