"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  createPrescription,
  type ActionState,
} from "@/lib/actions/prescricoes"
import type { DoctorOption } from "@/lib/doctor"

type PatientOption = { id: string; name: string }
type AttendanceOption = { id: string; label: string }

type ItemRow = {
  medication: string
  dosage: string
  frequency: string
  duration: string
  instructions: string
}

export function PrescriptionForm({
  patients,
  attendances,
  doctors,
  showDoctorSelect,
  preselectedAttendanceId,
  preselectedPatientId,
}: {
  patients: PatientOption[]
  attendances: AttendanceOption[]
  doctors: DoctorOption[]
  showDoctorSelect: boolean
  preselectedAttendanceId?: string
  preselectedPatientId?: string
}) {
  const router = useRouter()
  const [rows, setRows] = useState<ItemRow[]>([
    { medication: "", dosage: "", frequency: "", duration: "", instructions: "" },
  ])
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    createPrescription,
    null
  )

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message)
      if (state.prescriptionId) {
        router.push(`/prescricoes/${state.prescriptionId}`)
      }
    } else if (state && !state.success) {
      toast.error(state.message)
    }
  }, [state, router])

  function addRow() {
    setRows((prev) => [
      ...prev,
      { medication: "", dosage: "", frequency: "", duration: "", instructions: "" },
    ])
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index))
  }

  function updateRow(index: number, field: keyof ItemRow, value: string) {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nova prescrição</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Paciente *</FieldLabel>
              <select
                name="patientId"
                required
                defaultValue={preselectedPatientId ?? ""}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Selecione o paciente...</option>
                {patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel>Atendimento vinculado</FieldLabel>
              <select
                name="attendanceId"
                defaultValue={preselectedAttendanceId ?? ""}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Sem vínculo</option>
                {attendances.map((attendance) => (
                  <option key={attendance.id} value={attendance.id}>
                    {attendance.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {showDoctorSelect && (
            <Field>
              <FieldLabel>Médico responsável (assinatura) *</FieldLabel>
              <select
                name="doctorId"
                required
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Selecione o médico...</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name}
                    {doctor.crm ? ` — ${doctor.crm}` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                A assinatura cadastrada deste médico aparece na prescrição
                (tela, impressão e PDF enviado por WhatsApp).
              </p>
            </Field>
          )}

          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Medicamentos</h3>
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <Plus className="h-4 w-4" />
                Adicionar medicamento
              </Button>
            </div>

            {rows.map((row, index) => (
              <div
                key={index}
                className="grid gap-3 rounded-lg border p-4 md:grid-cols-5"
              >
                <Field className="md:col-span-1">
                  <FieldLabel>Medicamento *</FieldLabel>
                  <Input
                    name="medication"
                    value={row.medication}
                    onChange={(e) => updateRow(index, "medication", e.target.value)}
                    placeholder="Ex.: Losartana"
                    required={index === 0}
                  />
                </Field>
                <Field>
                  <FieldLabel>Dose</FieldLabel>
                  <Input
                    name="dosage"
                    value={row.dosage}
                    onChange={(e) => updateRow(index, "dosage", e.target.value)}
                    placeholder="Ex.: 50mg"
                  />
                </Field>
                <Field>
                  <FieldLabel>Frequência</FieldLabel>
                  <Input
                    name="frequency"
                    value={row.frequency}
                    onChange={(e) => updateRow(index, "frequency", e.target.value)}
                    placeholder="Ex.: de 12 em 12h"
                  />
                </Field>
                <Field>
                  <FieldLabel>Duração</FieldLabel>
                  <Input
                    name="duration"
                    value={row.duration}
                    onChange={(e) => updateRow(index, "duration", e.target.value)}
                    placeholder="Ex.: 30 dias"
                  />
                </Field>
                <div className="flex items-end gap-2">
                  <Field className="flex-1">
                    <FieldLabel>Orientações</FieldLabel>
                    <Input
                      name="instructions"
                      value={row.instructions}
                      onChange={(e) =>
                        updateRow(index, "instructions", e.target.value)
                      }
                      placeholder="Ex.: após o almoço"
                    />
                  </Field>
                  {rows.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRow(index)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar prescrição"}
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
