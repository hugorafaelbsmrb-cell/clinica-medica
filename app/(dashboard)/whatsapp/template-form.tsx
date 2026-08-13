"use client"

import { useActionState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import {
  createTemplateAction,
  type ActionState,
} from "@/lib/actions/whatsapp"

export function TemplateForm() {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    createTemplateAction,
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
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <Field>
        <FieldLabel>Nome do template *</FieldLabel>
        <Input name="name" placeholder="Ex.: Acompanhamento mensal" required />
      </Field>
      <Field>
        <FieldLabel>Tipo *</FieldLabel>
        <select
          name="type"
          required
          defaultValue="ACOMPANHAMENTO"
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="PRIMEIRO_CONTATO">Primeiro contato</option>
          <option value="ACOMPANHAMENTO">Acompanhamento</option>
        </select>
      </Field>
      <Field>
        <FieldLabel>Corpo da mensagem *</FieldLabel>
        <Textarea
          name="body"
          required
          placeholder="Use {{nome}} para o nome do paciente e {{data}} para a data atual."
        />
        <p className="text-xs text-muted-foreground">
          Variáveis disponíveis: {"{{nome}}"} e {"{{data}}"}
        </p>
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Salvar template"}
      </Button>
    </form>
  )
}
