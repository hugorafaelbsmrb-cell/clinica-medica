"use client"

import { useActionState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { sendMessageAction, type ActionState } from "@/lib/actions/whatsapp"

export function SendMessageForm({
  patients,
}: {
  patients: Array<{ id: string; name: string; phone: string | null }>
}) {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    sendMessageAction,
    null
  )
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message)
      formRef.current?.reset()
    } else if (state && !state.success) {
      toast.error(state.message)
    }
  }, [state])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Enviar mensagem manual</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          action={formAction}
          className="mx-auto flex max-w-xl flex-col gap-4"
        >
          <Field>
            <FieldLabel>Paciente *</FieldLabel>
            <select
              name="patientId"
              required
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Selecione o paciente...</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.name} — {patient.phone}
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel>Mensagem *</FieldLabel>
            <Textarea
              name="content"
              required
              placeholder="Escreva a mensagem que será enviada..."
            />
          </Field>
          <Button type="submit" disabled={pending || patients.length === 0}>
            <Send className="h-4 w-4" />
            {pending ? "Enviando..." : "Enviar mensagem"}
          </Button>
          {patients.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhum paciente com WhatsApp habilitado e telefone cadastrado.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
