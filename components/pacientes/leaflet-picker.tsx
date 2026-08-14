"use client"

/**
 * Mapa Leaflet com pino arrastável para ajuste fino da localização
 * do paciente (home care). Carregado somente no cliente (ssr: false):
 * o Leaflet depende de window e não roda no servidor.
 */
import { useEffect, useRef } from "react"
import L from "leaflet"
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet"
import "leaflet/dist/leaflet.css"

// Centro padrão (Brasília) enquanto o paciente não tem coordenadas.
const DEFAULT_CENTER: [number, number] = [-15.7801, -47.9292]

// Pino customizado (divIcon) para evitar o problema clássico de assets
// de ícone do Leaflet em bundlers.
const pinIcon = L.divIcon({
  className: "location-pin",
  html: `<svg width="30" height="40" viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 3px rgba(0,0,0,.4));">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="#e11d48"/>
    <circle cx="12" cy="12" r="5" fill="#fff"/>
  </svg>`,
  iconSize: [30, 40],
  iconAnchor: [15, 40],
})

/** Re-centraliza o mapa quando uma busca por endereço encontra coords. */
function Recenter({
  target,
  focusKey,
}: {
  target: [number, number] | null
  focusKey: number
}) {
  const map = useMap()
  const lastKey = useRef(focusKey)

  useEffect(() => {
    if (target && lastKey.current !== focusKey) {
      lastKey.current = focusKey
      map.flyTo(target, 16, { duration: 1 })
    }
  }, [target, focusKey, map])

  return null
}

export function LeafletPicker({
  latitude,
  longitude,
  focusKey,
  onMove,
}: {
  latitude: number | null
  longitude: number | null
  focusKey: number
  onMove: (lat: number, lng: number) => void
}) {
  const hasPosition = latitude !== null && longitude !== null
  const center: [number, number] = hasPosition
    ? [latitude, longitude]
    : DEFAULT_CENTER

  return (
    <div className="h-64 w-full overflow-hidden rounded-lg border">
      <MapContainer
        center={center}
        zoom={hasPosition ? 16 : 4}
        className="h-64 w-full"
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Recenter target={hasPosition ? center : null} focusKey={focusKey} />
        {hasPosition && (
          <Marker
            position={center}
            icon={pinIcon}
            draggable
            eventHandlers={{
              dragend: (event) => {
                const position = event.target.getLatLng()
                onMove(position.lat, position.lng)
              },
            }}
          />
        )}
      </MapContainer>
    </div>
  )
}
