"use client"

import { useActionState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import {
  createPatient,
  updatePatient,
  type ActionState,
} from "@/lib/actions/pacientes"

type PatientFormData = {
  id?: string
  name: string
  cpf?: string | null
  birthDate?: string | null
  phone?: string | null
  email?: string | null
  street?: string | null
  number?: string | null
  complement?: string | null
  neighborhood?: string | null
  city?: string | null
  state?: string | null
  zipCode?: string | null
  insurance?: string | null
  notes?: string | null
  consultationReason?: string | null
  lgpdConsent: boolean
  whatsappEnabled: boolean
}

export function PatientForm({
  patient,
}: {
  patient?: PatientFormData | null
}) {
  const router = useRouter()
  const isEdit = !!patient?.id
  const action = isEdit ? updatePatient : createPatient
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    action,
    null
  )

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message)
      if (state.patientId) {
        router.push(`/pacientes/${state.patientId}`)
      }
    } else if (state && !state.success) {
      toast.error(state.message)
    }
  }, [state, router])

  const toDateInput = (value?: string | Date | null) =>
    value ? new Date(value).toISOString().slice(0, 10) : ""

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? "Editar paciente" : "Novo paciente"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
          {patient?.id && <input type="hidden" name="id" value={patient.id} />}

          <section className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Nome completo *</FieldLabel>
              <Input
                name="name"
                defaultValue={patient?.name}
                placeholder="Nome do paciente"
                required
              />
            </Field>
            <Field>
              <FieldLabel>CPF</FieldLabel>
              <Input name="cpf" defaultValue={patient?.cpf ?? ""} placeholder="000.000.000-00" />
            </Field>
            <Field>
              <FieldLabel>Data de nascimento</FieldLabel>
              <Input
                type="date"
                name="birthDate"
                defaultValue={toDateInput(patient?.birthDate)}
              />
            </Field>
            <Field>
              <FieldLabel>Telefone (WhatsApp)</FieldLabel>
              <Input
                name="phone"
                defaultValue={patient?.phone ?? ""}
                placeholder="+55 (11) 99999-0000"
              />
            </Field>
            <Field>
              <FieldLabel>E-mail</FieldLabel>
              <Input
                type="email"
                name="email"
                defaultValue={patient?.email ?? ""}
                placeholder="paciente@email.com"
              />
            </Field>
            <Field>
              <FieldLabel>Convênio</FieldLabel>
              <Input
                name="insurance"
                defaultValue={patient?.insurance ?? ""}
                placeholder="Ex.: Unimed"
              />
            </Field>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Rua</FieldLabel>
              <Input name="street" defaultValue={patient?.street ?? ""} />
            </Field>
            <Field>
              <FieldLabel>Número</FieldLabel>
              <Input name="number" defaultValue={patient?.number ?? ""} />
            </Field>
            <Field>
              <FieldLabel>Complemento</FieldLabel>
              <Input name="complement" defaultValue={patient?.complement ?? ""} />
            </Field>
            <Field>
              <FieldLabel>Bairro</FieldLabel>
              <Input
                name="neighborhood"
                defaultValue={patient?.neighborhood ?? ""}
                placeholder="Usado nos relatórios por região"
              />
            </Field>
            <Field>
              <FieldLabel>Cidade</FieldLabel>
              <Input name="city" defaultValue={patient?.city ?? ""} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel>UF</FieldLabel>
                <Input
                  name="state"
                  defaultValue={patient?.state ?? ""}
                  maxLength={2}
                />
              </Field>
              <Field>
                <FieldLabel>CEP</FieldLabel>
                <Input name="zipCode" defaultValue={patient?.zipCode ?? ""} />
              </Field>
            </div>
          </section>

          <Field>
            <FieldLabel>Observações</FieldLabel>
            <Textarea
              name="notes"
              defaultValue={patient?.notes ?? ""}
              placeholder="Alergias, histórico relevante, preferências..."
            />
          </Field>

          <Field>
            <FieldLabel>Motivo da consulta</FieldLabel>
            <Textarea
              name="consultationReason"
              defaultValue={patient?.consultationReason ?? ""}
              placeholder="O que motivou a procura pela clínica"
            />
          </Field>

          <section className="flex flex-col gap-3 rounded-lg border p-4">
            <label className="flex items-start gap-3">
              <Checkbox name="lgpdConsent" defaultChecked={patient?.lgpdConsent} />
              <span className="text-sm">
                O paciente autoriza o armazenamento dos seus dados e o contato
                por WhatsApp (LGPD)
              </span>
            </label>
            <label className="flex items-start gap-3">
              <Checkbox
                name="whatsappEnabled"
                defaultChecked={patient?.whatsappEnabled}
              />
              <span className="text-sm">
                Habilitar mensagens automáticas de acompanhamento de saúde
              </span>
            </label>
          </section>

          <div className="flex gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar"}
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
