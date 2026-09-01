"use client"

import { useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { PlayCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { startJourneyForPatient } from "@/lib/actions/journeys"

export function StartJourneyForm({
  patients,
  journeys,
}: {
  patients: Array<{ id: string; name: string; phone: string | null }>
  journeys: Array<{ id: string; name: string; steps: number }>
}) {
  const [patientId, setPatientId] = useState("")
  const [journeyId, setJourneyId] = useState("")
  const [pending, startPending] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!patientId || !journeyId) {
      toast.error("Selecione o paciente e a jornada")
      return
    }
    startPending(async () => {
      const result = await startJourneyForPatient(patientId, journeyId)
      if (result.success) {
        toast.success(result.message)
        setPatientId("")
        setJourneyId("")
        formRef.current?.reset()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Jornada de mensagens</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-xl flex-col gap-4"
        >
          <Field>
            <FieldLabel>Paciente *</FieldLabel>
            <select
              value={patientId}
              onChange={(event) => setPatientId(event.target.value)}
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
            <FieldLabel>Jornada *</FieldLabel>
            <select
              value={journeyId}
              onChange={(event) => setJourneyId(event.target.value)}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Selecione a jornada...</option>
              {journeys.map((journey) => (
                <option key={journey.id} value={journey.id}>
                  {journey.name} ({journey.steps}{" "}
                  {journey.steps === 1 ? "mensagem" : "mensagens"})
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Cada passo sai no intervalo definido na jornada. Se a equipe
              assumir a conversa, o bot pausa e os passos seguintes são
              suprimidos.
            </p>
          </Field>

          <Button
            type="submit"
            disabled={
              pending || patients.length === 0 || journeys.length === 0
            }
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="h-4 w-4" />
            )}
            {pending ? "Iniciando..." : "Iniciar jornada"}
          </Button>

          {journeys.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhuma jornada ativa. Crie uma em Automações → Jornadas de
              mensagens.
            </p>
          )}
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
