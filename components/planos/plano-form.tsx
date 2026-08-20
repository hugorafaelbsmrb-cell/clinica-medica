"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { VoiceTextarea } from "@/components/ui/voice-textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  createPlan,
  updatePlan,
  previewSummaryWithAI,
  type ActionState,
} from "@/lib/actions/planos"

type PatientOption = { id: string; name: string }

export type PlanInitialData = {
  id?: string
  patientId?: string
  diagnosis?: string
  goals?: string | null
  guidelines?: string | null
  summary?: string | null
}

export function PlanForm({
  patients,
  initial,
  preselectedPatientId,
}: {
  patients: PatientOption[]
  initial?: PlanInitialData
  preselectedPatientId?: string
}) {
  const router = useRouter()
  const isEditing = Boolean(initial?.id)
  const action = isEditing ? updatePlan : createPlan

  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    action,
    null
  )

  const formRef = useRef<HTMLFormElement>(null)
  const [summary, setSummary] = useState(initial?.summary ?? "")
  const [aiGenerated, setAiGenerated] = useState(false)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message)
      if (state.planId) {
        router.push(`/planos-terapeuticos/${state.planId}`)
      }
    } else if (state && !state.success) {
      toast.error(state.message)
    }
  }, [state, router])

  async function handleGenerateSummary() {
    const form = formRef.current
    if (!form) return

    const formData = new FormData(form)
    const patientId = formData.get("patientId")?.toString() ?? ""
    if (!patientId) {
      toast.error("Selecione o paciente antes de gerar o resumo")
      return
    }

    const diagnosis = formData.get("diagnosis")?.toString() ?? ""
    if (diagnosis.trim().length < 3) {
      toast.error("Informe o diagnóstico antes de gerar o resumo")
      return
    }

    setGenerating(true)
    try {
      const result = await previewSummaryWithAI({
        patientId,
        diagnosis,
        goals: formData.get("goals")?.toString() || null,
        guidelines: formData.get("guidelines")?.toString() || null,
      })
      if (result.success && result.content) {
        setSummary(result.content)
        setAiGenerated(true)
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }
    } catch {
      toast.error("Falha ao gerar o resumo — tente novamente")
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEditing ? "Editar plano terapêutico" : "Novo plano terapêutico"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="flex flex-col gap-6">
          {isEditing && <input type="hidden" name="id" value={initial!.id} />}
          <input type="hidden" name="source" value={aiGenerated ? "IA" : "MANUAL"} />

          <Field>
            <FieldLabel>Paciente *</FieldLabel>
            <select
              name="patientId"
              required
              defaultValue={initial?.patientId ?? preselectedPatientId ?? ""}
              disabled={isEditing}
              className="h-9 rounded-md border bg-background px-3 text-sm disabled:opacity-60"
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
            <FieldLabel>Diagnóstico *</FieldLabel>
            <VoiceTextarea
              name="diagnosis"
              required
              minLength={3}
              defaultValue={initial?.diagnosis ?? ""}
              placeholder="Ex.: Hipertensão arterial estágio 1 associada a sobrepeso"
              rows={3}
            />
          </Field>

          <Field>
            <FieldLabel>Metas do tratamento</FieldLabel>
            <VoiceTextarea
              name="goals"
              defaultValue={initial?.goals ?? ""}
              placeholder="Ex.: Controlar a pressão arterial abaixo de 130x85 mmHg e perder 5 kg em 3 meses"
              rows={3}
            />
          </Field>

          <Field>
            <FieldLabel>Orientações e condutas</FieldLabel>
            <VoiceTextarea
              name="guidelines"
              defaultValue={initial?.guidelines ?? ""}
              placeholder="Ex.: Dieta com restrição de sódio, caminhada 3x por semana, retorno em 30 dias"
              rows={3}
            />
          </Field>

          <Field>
            <FieldLabel>Resumo do plano (opcional — pode ser gerado por IA)</FieldLabel>
            <VoiceTextarea
              name="summary"
              value={summary}
              onValueChange={(next) => {
                setSummary(next)
                setAiGenerated(false)
              }}
              placeholder="Resumo em linguagem simples para o paciente, ou clique em gerar com IA abaixo."
              rows={4}
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleGenerateSummary}
              disabled={generating || pending}
              className="self-start"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {generating ? "Gerando com IA..." : "Gerar resumo com IA"}
            </Button>
          </Field>

          <div className="flex gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar plano"}
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
