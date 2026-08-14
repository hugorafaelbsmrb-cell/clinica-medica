"use client"

/**
 * Seção de localização do paciente (home care) dentro do formulário:
 * campos ocultos de latitude/longitude + origem, botão de geocodificação
 * pelo endereço (Nominatim) e mapa Leaflet com pino arrastável.
 */
import { useState, useTransition } from "react"
import dynamic from "next/dynamic"
import { toast } from "sonner"
import { Loader2, LocateFixed } from "lucide-react"
import { Button } from "@/components/ui/button"
import { geocodePatientAddress } from "@/lib/actions/pacientes"

const LeafletPicker = dynamic(
  () =>
    import("@/components/pacientes/leaflet-picker").then(
      (module) => module.LeafletPicker
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 w-full items-center justify-center rounded-lg border bg-muted text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando mapa...
      </div>
    ),
  }
)

const SOURCE_LABEL: Record<string, string> = {
  GPS: "GPS (posição atual)",
  GEOCODE: "Endereço",
  MANUAL: "Pino no mapa",
}

export function LocationPicker({
  initialLatitude,
  initialLongitude,
  initialSource,
}: {
  initialLatitude?: number | null
  initialLongitude?: number | null
  initialSource?: string | null
}) {
  const [latitude, setLatitude] = useState(
    initialLatitude != null ? String(initialLatitude) : ""
  )
  const [longitude, setLongitude] = useState(
    initialLongitude != null ? String(initialLongitude) : ""
  )
  const [source, setSource] = useState(initialSource ?? "")
  const [focusKey, setFocusKey] = useState(0)
  const [searching, startSearch] = useTransition()
  const [locating, setLocating] = useState(false)

  const latNum = latitude !== "" ? Number(latitude) : null
  const lngNum = longitude !== "" ? Number(longitude) : null

  function readField(form: HTMLFormElement | null, name: string): string {
    if (!form) return ""
    const element = form.elements.namedItem(name)
    return element instanceof HTMLInputElement ? element.value.trim() : ""
  }

  // GPS como forma padrão no home care: a equipe está na casa do paciente
  // durante o cadastro/edição — é o jeito mais preciso de marcar o ponto.
  function handleUseMyLocation() {
    if (!("geolocation" in navigator)) {
      toast.error("Seu navegador não suporta localização.")
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(String(position.coords.latitude))
        setLongitude(String(position.coords.longitude))
        setSource("GPS")
        setFocusKey((key) => key + 1)
        setLocating(false)
        toast.success("Localização capturada!")
      },
      () => {
        setLocating(false)
        toast.error("Não foi possível capturar sua localização agora.")
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  function handleGeocode(form: HTMLFormElement | null) {
    const street = readField(form, "street")
    const city = readField(form, "city")
    if (!street || !city) {
      toast.error("Preencha rua e cidade antes de buscar no mapa")
      return
    }
    startSearch(async () => {
      const result = await geocodePatientAddress({
        street,
        number: readField(form, "number"),
        neighborhood: readField(form, "neighborhood"),
        city,
        state: readField(form, "state"),
      })
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
      setFocusKey((key) => key + 1)
      toast.success("Coordenadas encontradas pelo endereço")
    })
  }

  function handleMapMove(lat: number, lng: number) {
    setLatitude(String(lat))
    setLongitude(String(lng))
    setSource("MANUAL")
  }

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="latitude" value={latitude} />
      <input type="hidden" name="longitude" value={longitude} />
      <input type="hidden" name="locationSource" value={source} />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={locating || searching}
          onClick={handleUseMyLocation}
        >
          {locating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LocateFixed className="h-4 w-4" />
          )}
          {locating ? "Capturando..." : "Usar minha localização"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={searching || locating}
          onClick={(event) => handleGeocode(event.currentTarget.form)}
        >
          {searching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LocateFixed className="h-4 w-4" />
          )}
          Buscar coordenadas pelo endereço
        </Button>
        {source && (
          <span className="text-xs text-muted-foreground">
            Origem: {SOURCE_LABEL[source] ?? source}
            {latitude && longitude ? ` — ${latitude}, ${longitude}` : ""}
          </span>
        )}
      </div>

      <LeafletPicker
        latitude={latNum}
        longitude={lngNum}
        focusKey={focusKey}
        onMove={handleMapMove}
      />
      <p className="text-xs text-muted-foreground">
        Arraste o pino para ajustar o ponto exato da casa. Sem coordenadas,
        o médico navega pelo endereço digitado.
      </p>
    </div>
  )
}
