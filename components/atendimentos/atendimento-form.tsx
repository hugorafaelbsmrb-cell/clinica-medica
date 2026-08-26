"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CheckCircle2, Loader2, LocateFixed, MapPin } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { buildAddress } from "@/lib/geo"
import {
  createAttendance,
  geocodeAttendanceAddress,
  type ActionState,
} from "@/lib/actions/atendimentos"
import type { DoctorOption } from "@/lib/doctor"

type PatientOption = {
  id: string
  name: string
  neighborhood: string | null
  street: string | null
  number: string | null
  city: string | null
  state: string | null
  latitude: number | null
  longitude: number | null
}

const SOURCE_LABEL: Record<string, string> = {
  GPS: "Localização capturada (GPS)",
  GEOCODE: "Coordenadas pelo endereço",
  PATIENT: "Localização do cadastro do paciente",
  MANUAL: "Ajuste manual",
}

export function AttendanceForm({
  patients,
  doctors,
  showDoctorSelect,
  preselectedPatientId,
  publicDisabledTypes = [],
}: {
  patients: PatientOption[]
  doctors: DoctorOption[]
  showDoctorSelect: boolean
  preselectedPatientId?: string
  publicDisabledTypes?: ("PRESENCIAL" | "DOMICILIAR" | "TELECONSULTA")[]
}) {
  const router = useRouter()
  // Home care é o modelo do sistema: domiciliar como padrão.
  const [type, setType] = useState<"PRESENCIAL" | "DOMICILIAR" | "TELECONSULTA">(
    "DOMICILIAR"
  )
  const [address, setAddress] = useState("")
  const [latitude, setLatitude] = useState("")
  const [longitude, setLongitude] = useState("")
  const [source, setSource] = useState("")
  const [gpsStatus, setGpsStatus] = useState<"idle" | "loading" | "error">(
    "idle"
  )
  const [geocoding, startGeocoding] = useTransition()
  const [state, formAction, pending] = useActionState<
    ActionState | null,
    FormData
  >(createAttendance, null)

  function applyPatient(patient: PatientOption | undefined) {
    if (!patient) {
      setAddress("")
      setLatitude("")
      setLongitude("")
      setSource("")
      return
    }
    setAddress(
      buildAddress({
        street: patient.street,
        number: patient.number,
        neighborhood: patient.neighborhood,
        city: patient.city,
        state: patient.state,
      })
    )
    if (patient.latitude != null && patient.longitude != null) {
      setLatitude(String(patient.latitude))
      setLongitude(String(patient.longitude))
      setSource("PATIENT")
    } else {
      setLatitude("")
      setLongitude("")
      setSource("")
    }
  }

  // Paciente já selecionado ao abrir (ex.: botão na página do paciente).
  useEffect(() => {
    if (preselectedPatientId) {
      applyPatient(patients.find((patient) => patient.id === preselectedPatientId))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  function handlePatientChange(event: React.ChangeEvent<HTMLSelectElement>) {
    applyPatient(patients.find((patient) => patient.id === event.target.value))
  }

  function handleAddressChange(event: React.ChangeEvent<HTMLInputElement>) {
    setAddress(event.target.value)
    // Endereço editado: coordenadas por geocode/cadastro ficam desatualizadas
    // (o GPS continua válido, foi capturado no próprio local).
    if (source !== "GPS") {
      setLatitude("")
      setLongitude("")
      setSource("")
    }
  }

  // Captura de localização como forma padrão: o atendimento domiciliar
  // acontece na casa do paciente — o GPS do aparelho é o caminho mais
  // preciso quando a equipe está no local.
  function handleUseMyLocation() {
    if (!("geolocation" in navigator)) {
      setGpsStatus("error")
      toast.error("Seu navegador não suporta localização.")
      return
    }
    setGpsStatus("loading")
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(String(position.coords.latitude))
        setLongitude(String(position.coords.longitude))
        setSource("GPS")
        setGpsStatus("idle")
        toast.success("Localização capturada! O médico navegará direto até aqui.")
      },
      () => {
        setGpsStatus("error")
        toast.error("Não foi possível capturar sua localização agora.")
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  function handleGeocode() {
    if (address.trim().length < 8) {
      toast.error("Preencha o endereço antes de buscar as coordenadas")
      return
    }
    startGeocoding(async () => {
      const result = await geocodeAttendanceAddress(address)
      if (
        !result.success ||
        result.latitude === undefined ||
        result.longitude === undefined
      ) {
        toast.error(result.message ?? "Endereço não encontrado")
        return
      }
      setLatitude(String(result.latitude))
      setLongitude(String(result.longitude))
      setSource("GEOCODE")
      toast.success("Coordenadas encontradas pelo endereço")
    })
  }

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
              onChange={handlePatientChange}
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

          {showDoctorSelect && (
            <Field>
              <FieldLabel>Médico responsável</FieldLabel>
              <select
                name="doctorId"
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">A definir</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name}
                    {doctor.crm ? ` — ${doctor.crm}` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                A assinatura deste médico aparecerá no prontuário quando o
                atendimento for realizado.
              </p>
            </Field>
          )}

          <Field>
            <FieldLabel>Tipo de atendimento *</FieldLabel>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="type"
                  value="DOMICILIAR"
                  checked={type === "DOMICILIAR"}
                  onChange={() => setType("DOMICILIAR")}
                />
                Domiciliar
                {publicDisabledTypes.includes("DOMICILIAR") && (
                  <span className="text-xs text-muted-foreground">
                    (desabilitado no agendamento público)
                  </span>
                )}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="type"
                  value="PRESENCIAL"
                  checked={type === "PRESENCIAL"}
                  onChange={() => setType("PRESENCIAL")}
                />
                Presencial (na clínica)
                {publicDisabledTypes.includes("PRESENCIAL") && (
                  <span className="text-xs text-muted-foreground">
                    (desabilitado no agendamento público)
                  </span>
                )}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="type"
                  value="TELECONSULTA"
                  checked={type === "TELECONSULTA"}
                  onChange={() => setType("TELECONSULTA")}
                />
                Teleconsulta (vídeo chamada)
                {publicDisabledTypes.includes("TELECONSULTA") && (
                  <span className="text-xs text-muted-foreground">
                    (desabilitado no agendamento público)
                  </span>
                )}
              </label>
            </div>
          </Field>

          {type === "DOMICILIAR" && (
            <>
              <Field>
                <FieldLabel>Endereço do domicílio *</FieldLabel>
                <Input
                  name="homeAddress"
                  value={address}
                  onChange={handleAddressChange}
                  placeholder="Rua, número, bairro — onde o atendimento será realizado"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Preenchido com o endereço do cadastro — edite se o
                  atendimento for em outro lugar.
                </p>
              </Field>

              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <p className="text-sm font-medium">Localização para navegação</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="h-11"
                    onClick={handleUseMyLocation}
                    disabled={gpsStatus === "loading" || geocoding}
                  >
                    {gpsStatus === "loading" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <LocateFixed className="h-4 w-4" />
                    )}
                    {gpsStatus === "loading"
                      ? "Capturando..."
                      : "Usar minha localização"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={handleGeocode}
                    disabled={geocoding || gpsStatus === "loading"}
                  >
                    {geocoding ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MapPin className="h-4 w-4" />
                    )}
                    Buscar coordenadas pelo endereço
                  </Button>
                </div>
                {source && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    {SOURCE_LABEL[source] ?? source}
                    {latitude && longitude ? ` — ${latitude}, ${longitude}` : ""}
                  </p>
                )}
                <input type="hidden" name="latitude" value={latitude} />
                <input type="hidden" name="longitude" value={longitude} />
                <input type="hidden" name="locationSource" value={source} />
              </div>
            </>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Data e hora *</FieldLabel>
              <Input
                type="datetime-local"
                name="scheduledAt"
                defaultValue={(() => {
                  // Fuso local (Brasília): evita o -3h do toISOString (UTC).
                  const d = new Date()
                  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
                    2,
                    "0"
                  )}-${String(d.getDate()).padStart(2, "0")}T${String(
                    d.getHours()
                  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
                })()}
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
