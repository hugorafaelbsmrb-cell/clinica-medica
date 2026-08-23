"use client"

import { useActionState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  createEntry,
  updateEntry,
  type ActionState,
} from "@/lib/actions/financeiro"

export type EntryInitialData = {
  id?: string
  type?: string
  category?: string
  description?: string
  value?: string
  dueDate?: string
  paymentMethod?: string | null
}

const CATEGORIES: { value: string; label: string; group: string }[] = [
  { value: "CONSULTA_PRESENCIAL", label: "Consulta presencial", group: "receita" },
  { value: "CONSULTA_DOMICILIAR", label: "Consulta domiciliar", group: "receita" },
  { value: "TELECONSULTA", label: "Teleconsulta", group: "receita" },
  { value: "ACOMPANHAMENTO", label: "Acompanhamento", group: "receita" },
  { value: "PROCEDIMENTO", label: "Procedimento", group: "receita" },
  { value: "MEDICAMENTO", label: "Medicamento", group: "despesa" },
  { value: "OPERACIONAL", label: "Operacional", group: "despesa" },
  { value: "OUTRO", label: "Outro", group: "ambos" },
]

export function EntryForm({ initial }: { initial?: EntryInitialData }) {
  const router = useRouter()
  const isEditing = Boolean(initial?.id)
  const action = isEditing ? updateEntry : createEntry

  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    action,
    null
  )

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message)
      router.push("/financeiro")
    } else if (state && !state.success) {
      toast.error(state.message)
    }
  }, [state, router])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEditing ? "Editar lançamento" : "Novo lançamento"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
          {isEditing && <input type="hidden" name="id" value={initial!.id} />}

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Tipo *</FieldLabel>
              <select
                name="type"
                required
                defaultValue={initial?.type ?? "RECEITA"}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="RECEITA">Receita (entrada)</option>
                <option value="DESPESA">Despesa (saída)</option>
              </select>
            </Field>
            <Field>
              <FieldLabel>Categoria *</FieldLabel>
              <select
                name="category"
                required
                defaultValue={initial?.category ?? ""}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Selecione...</option>
                {CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field>
            <FieldLabel>Descrição *</FieldLabel>
            <Input
              name="description"
              required
              minLength={3}
              defaultValue={initial?.description ?? ""}
              placeholder="Ex.: Consulta domiciliar — Maria Silva"
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-3">
            <Field>
              <FieldLabel>Valor (R$) *</FieldLabel>
              <Input
                name="value"
                type="number"
                step="0.01"
                min="0.01"
                required
                defaultValue={initial?.value ?? ""}
                placeholder="0,00"
              />
            </Field>
            <Field>
              <FieldLabel>Vencimento *</FieldLabel>
              <Input
                name="dueDate"
                type="date"
                required
                defaultValue={initial?.dueDate ?? ""}
              />
            </Field>
            <Field>
              <FieldLabel>Forma de pagamento</FieldLabel>
              <select
                name="paymentMethod"
                defaultValue={initial?.paymentMethod ?? ""}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Não informada</option>
                <option value="PIX">PIX</option>
                <option value="DINHEIRO">Dinheiro</option>
                <option value="CARTAO">Cartão</option>
                <option value="TRANSFERENCIA">Transferência</option>
              </select>
            </Field>
          </div>

          <div className="flex gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar lançamento"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={pending}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
