"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import {
  createAttendance,
  type ActionState,
} from "@/lib/actions/atendimentos"

type PatientOption = { id: string; name: string; neighborhood: string | null }

export function AttendanceForm({
  patients,
  preselectedPatientId,
}: {
  patients: PatientOption[]
  preselectedPatientId?: string
}) {
  const router = useRouter()
  const [type, setType] = useState<"PRESENCIAL" | "DOMICILIAR">("PRESENCIAL")
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    createAttendance,
    null
  )

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message)
      if (state.attendanceId) {
        router.push(`/atendimentos/${state.attendanceId}`)
      }
    } else if (state && !state.success) {
      toast.error(state.message)
    }
  }, [state, router])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Novo atendimento</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
          <Field>
            <FieldLabel>Paciente *</FieldLabel>
            <select
              name="patientId"
              defaultValue={preselectedPatientId ?? ""}
              required
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Selecione o paciente...</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.name}
                  {patient.neighborhood ? ` — ${patient.neighborhood}` : ""}
                </option>
              ))}
            </select>
          </Field>

          <Field>
            <FieldLabel>Tipo de atendimento *</FieldLabel>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="type"
                  value="PRESENCIAL"
                  checked={type === "PRESENCIAL"}
                  onChange={() => setType("PRESENCIAL")}
                />
                Presencial (na clínica)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="type"
                  value="DOMICILIAR"
                  checked={type === "DOMICILIAR"}
                  onChange={() => setType("DOMICILIAR")}
                />
                Domiciliar
              </label>
            </div>
          </Field>

          {type === "DOMICILIAR" && (
            <Field>
              <FieldLabel>Endereço do domicílio *</FieldLabel>
              <Input
                name="homeAddress"
                placeholder="Rua, número, bairro — onde o atendimento será realizado"
                required
              />
            </Field>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Data e hora *</FieldLabel>
              <Input
                type="datetime-local"
                name="scheduledAt"
                defaultValue={new Date().toISOString().slice(0, 16)}
                required
              />
            </Field>
            <Field>
              <FieldLabel>Valor (R$)</FieldLabel>
              <Input
                type="number"
                name="value"
                step="0.01"
                min="0"
                defaultValue="0"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel>Anamnese inicial</FieldLabel>
            <Textarea
              name="anamnesis"
              placeholder="Registre aqui os dados iniciais da consulta..."
            />
          </Field>

          <div className="flex gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Agendando..." : "Agendar"}
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
