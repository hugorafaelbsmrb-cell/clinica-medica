"use client"

/**
 * Cartões do módulo "Atendimentos do dia" (home care, mobile-first).
 * A ação principal é Iniciar/Finalizar atendimento; em seguida vêm a
 * prescrição, o plano terapêutico e as opções de navegação (Google
 * Maps/Waze), ligação e WhatsApp. Com a localização do médico, os
 * cartões mostram a distância e são ordenados do mais próximo ao
 * mais distante.
 */
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  CarFront,
  FileText,
  Loader2,
  LocateFixed,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  PlayCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  haversineKm,
  mapsNavigationUrl,
  mapsSearchUrl,
  wazeNavigationUrl,
} from "@/lib/geo"
import { completeAttendance, startAttendance } from "@/lib/actions/atendimentos"

export type DayCardData = {
  id: string
  status: "AGENDADO" | "EM_ATENDIMENTO"
  scheduledAt: string
  startedAt: string | null
  type: "PRESENCIAL" | "DOMICILIAR"
  patientId: string
  patientName: string
  age: number | null
  reason: string | null
  address: string
  phone: string | null
  latitude: number | null
  longitude: number | null
  medications: string[]
  planDiagnosis: string | null
  planSummary: string | null
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`
}

function DayCard({
  attendance,
  distanceKm,
}: {
  attendance: DayCardData
  distanceKm: number | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<"start" | "complete" | null>(null)

  const hasCoords = attendance.latitude !== null && attendance.longitude !== null
  const navigateUrl = hasCoords
    ? mapsNavigationUrl(attendance.latitude!, attendance.longitude!)
    : mapsSearchUrl(attendance.address)
  const wazeUrl = hasCoords
    ? wazeNavigationUrl(attendance.latitude!, attendance.longitude!)
    : null
  const phoneDigits = attendance.phone?.replace(/\D/g, "") ?? ""

  async function handleStart() {
    setBusy("start")
    const result = await startAttendance(attendance.id)
    setBusy(null)
    if (result.success) {
      toast.success(result.message)
      router.refresh()
    } else {
      toast.error(result.message)
    }
  }

  async function handleComplete() {
    setBusy("complete")
    const result = await completeAttendance(attendance.id)
    setBusy(null)
    if (result.success) {
      toast.success(result.message)
      router.refresh()
    } else {
      toast.error(result.message)
    }
  }

  return (
    <Card className={attendance.status === "EM_ATENDIMENTO" ? "border-primary" : ""}>
      <CardContent className="flex flex-col gap-4 p-4">
        {/* Hora + badges */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <Clock className="h-4 w-4" />
            {formatTime(attendance.scheduledAt)}
          </span>
          {attendance.status === "EM_ATENDIMENTO" && (
            <Badge>Em atendimento</Badge>
          )}
          <Badge variant="outline">
            {attendance.type === "DOMICILIAR" ? "Domiciliar" : "Presencial"}
          </Badge>
          {distanceKm !== null && (
            <Badge variant="secondary">{distanceKm.toFixed(1)} km</Badge>
          )}
        </div>

        {/* Paciente */}
        <div>
          <p className="text-lg font-semibold leading-tight">
            {attendance.patientName}
            {attendance.age !== null && (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {attendance.age} anos
              </span>
            )}
          </p>
          {attendance.reason && (
            <p className="mt-1 text-sm text-muted-foreground">
              Motivo: {attendance.reason}
            </p>
          )}
        </div>

        {/* Endereço */}
        <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-sm">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span className="break-words">{attendance.address}</span>
        </div>

        {/* Dados clínicos para prescrever */}
        {attendance.medications.length > 0 && (
          <div className="text-sm">
            <p className="font-medium">Medicamentos atuais</p>
            <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
              {attendance.medications.map((medication) => (
                <li key={medication}>• {medication}</li>
              ))}
            </ul>
          </div>
        )}
        {attendance.planDiagnosis && (
          <div className="text-sm">
            <p className="font-medium">Plano terapêutico vigente</p>
            <p className="mt-1 text-muted-foreground">
              {attendance.planDiagnosis}
              {attendance.planSummary ? ` — ${attendance.planSummary}` : ""}
            </p>
          </div>
        )}

        {/* Ação principal: iniciar/finalizar atendimento */}
        {attendance.status === "AGENDADO" ? (
          <Button
            className="h-12 w-full text-base"
            onClick={handleStart}
            disabled={busy !== null}
          >
            {busy === "start" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <PlayCircle className="h-5 w-5" />
            )}
            {busy === "start" ? "Iniciando..." : "Iniciar atendimento"}
          </Button>
        ) : (
          <Button
            className="h-12 w-full text-base"
            onClick={handleComplete}
            disabled={busy !== null}
          >
            {busy === "complete" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
            {busy === "complete" ? "Finalizando..." : "Finalizar atendimento"}
          </Button>
        )}

        {/* Prescrição e plano terapêutico */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="h-12 text-base"
            render={
              <a href={`/prescricoes/novo?atendimento=${attendance.id}`} />
            }
          >
            <FileText className="h-5 w-5" />
            Prescrever
          </Button>
          <Button
            variant="outline"
            className="h-12 text-base"
            render={
              <a href={`/planos-terapeuticos/novo?atendimento=${attendance.id}`} />
            }
          >
            <ClipboardList className="h-5 w-5" />
            Plano terapêutico
          </Button>
        </div>

        {/* Navegação e contato */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            className="h-12 text-base"
            render={
              <a href={navigateUrl} target="_blank" rel="noopener noreferrer" />
            }
          >
            <Navigation className="h-5 w-5" />
            Navegar
          </Button>
          {wazeUrl ? (
            <Button
              variant="outline"
              className="h-12 text-base"
              render={
                <a href={wazeUrl} target="_blank" rel="noopener noreferrer" />
              }
            >
              <CarFront className="h-5 w-5" />
              Waze
            </Button>
          ) : (
            <Button
              variant="outline"
              className="h-12 text-base"
              render={
                <a href={navigateUrl} target="_blank" rel="noopener noreferrer" />
              }
            >
              <MapPin className="h-5 w-5" />
              Buscar no mapa
            </Button>
          )}
          {phoneDigits && (
            <>
              <Button
                variant="outline"
                className="h-12 text-base"
                render={<a href={`tel:${phoneDigits}`} />}
              >
                <Phone className="h-5 w-5" />
                Ligar
              </Button>
              <Button
                variant="outline"
                className="h-12 text-base"
                render={
                  <a
                    href={`https://wa.me/${phoneDigits}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                <MessageCircle className="h-5 w-5" />
                WhatsApp
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function DayCards({ attendances }: { attendances: DayCardData[] }) {
  const [myLocation, setMyLocation] = useState<{
    latitude: number
    longitude: number
  } | null>(null)
  const [locStatus, setLocStatus] = useState<"idle" | "loading" | "error">(
    "idle"
  )

  function handleUseMyLocation() {
    if (!("geolocation" in navigator)) {
      setLocStatus("error")
      toast.error("Seu navegador não suporta localização.")
      return
    }
    setLocStatus("loading")
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setMyLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
        setLocStatus("idle")
        toast.success("Localização obtida — ordenando pela distância")
      },
      () => {
        setLocStatus("error")
        toast.error("Não foi possível obter sua localização agora.")
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 }
    )
  }

  const withDistance = attendances.map((attendance) => {
    const distanceKm =
      myLocation &&
      attendance.latitude !== null &&
      attendance.longitude !== null
        ? haversineKm(myLocation, {
            latitude: attendance.latitude,
            longitude: attendance.longitude,
          })
        : null
    return { attendance, distanceKm }
  })

  if (myLocation) {
    withDistance.sort((a, b) => {
      if (a.distanceKm === null && b.distanceKm === null) return 0
      if (a.distanceKm === null) return 1
      if (b.distanceKm === null) return -1
      return a.distanceKm - b.distanceKm
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={handleUseMyLocation}
          disabled={locStatus === "loading"}
        >
          {locStatus === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LocateFixed className="h-4 w-4" />
          )}
          {myLocation
            ? "Atualizar minha localização"
            : "Usar minha localização"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {myLocation
            ? "Cartões ordenados do mais próximo ao mais distante"
            : "Ordene pela distância até o paciente (opcional)"}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {withDistance.map(({ attendance, distanceKm }) => (
          <DayCard
            key={attendance.id}
            attendance={attendance}
            distanceKm={distanceKm}
          />
        ))}
      </div>
    </div>
  )
}
