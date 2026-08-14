/**
 * Utilidades de geografia para o home care: geocodificação de endereços
 * (Nominatim/OpenStreetMap, gratuito e sem chave de API) e links de
 * navegação (Google Maps/Waze) usados no módulo "Atendimentos do dia".
 */

export type LatLng = { latitude: number; longitude: number }

const GEOCODE_BASE = "https://nominatim.openstreetmap.org/search"

/**
 * Geocodifica um endereço brasileiro via Nominatim.
 * Política de uso: máx. 1 requisição por segundo e User-Agent identificável.
 */
export async function geocodeAddress(address: string): Promise<LatLng | null> {
  const url = `${GEOCODE_BASE}?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(address)}`
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "clinica-medica-homecare/1.0 (sistema de agenda da clínica)",
        Accept: "application/json",
      },
      cache: "no-store",
    })
    if (!response.ok) return null

    const data = (await response.json()) as Array<{ lat?: string; lon?: string }>
    const first = data[0]
    if (!first?.lat || !first?.lon) return null

    const latitude = Number(first.lat)
    const longitude = Number(first.lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

    return { latitude, longitude }
  } catch {
    return null
  }
}

/** Deep link do Google Maps: abre o app com a rota até as coordenadas. */
export function mapsNavigationUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`
}

/** Busca no Google Maps por endereço (fallback sem coordenadas). */
export function mapsSearchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

/** Deep link do Waze com a navegação iniciada. */
export function wazeNavigationUrl(latitude: number, longitude: number): string {
  return `https://waze.com/ul?ll=${latitude},${longitude}&navigate=yes`
}

/** Distância em linha reta (km) entre dois pontos — fórmula de haversine. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) *
      Math.cos(toRad(b.latitude)) *
      Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

type AddressParts = {
  street?: string | null
  number?: string | null
  neighborhood?: string | null
  city?: string | null
  state?: string | null
}

/** Monta o endereço por extenso para geocodificação ou busca no mapa. */
export function buildAddress(parts: AddressParts): string {
  const street =
    parts.street && parts.number
      ? `${parts.street}, ${parts.number}`
      : (parts.street ?? "")
  return [street, parts.neighborhood, parts.city, parts.state]
    .filter(Boolean)
    .join(", ")
}
