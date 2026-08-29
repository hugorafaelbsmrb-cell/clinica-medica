/**
 * Utilidades de geografia para o home care: geocodificação de endereços
 * (Nominatim/OpenStreetMap, gratuito e sem chave de API) e links de
 * navegação (Google Maps/Waze) usados no módulo "Atendimentos do dia".
 */

export type LatLng = { latitude: number; longitude: number }

const GEOCODE_BASE = "https://nominatim.openstreetmap.org/search"
const REVERSE_GEOCODE_BASE = "https://nominatim.openstreetmap.org/reverse"
const GEOCODE_HEADERS = {
  "User-Agent": "clinica-medica-homecare/1.0 (sistema de agenda da clínica)",
  Accept: "application/json",
}

/**
 * Geocodifica um endereço brasileiro via Nominatim.
 * Política de uso: máx. 1 requisição por segundo e User-Agent identificável.
 */
export async function geocodeAddress(address: string): Promise<LatLng | null> {
  const url = `${GEOCODE_BASE}?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(address)}`
  try {
    const response = await fetch(url, {
      headers: GEOCODE_HEADERS,
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

/**
 * Geocodificação reversa (coordenadas → endereço) via Nominatim.
 * Usada para preencher os campos de endereço a partir do GPS capturado
 * (wizard público e formulário interno). Mesma política de uso do
 * geocodeAddress: máx. 1 requisição por segundo, User-Agent identificável.
 */
export async function reverseGeocodeAddress(
  latitude: number,
  longitude: number
): Promise<AddressParts | null> {
  const url = `${REVERSE_GEOCODE_BASE}?format=json&addressdetails=1&accept-language=pt-BR&lat=${latitude}&lon=${longitude}`
  try {
    const response = await fetch(url, {
      headers: GEOCODE_HEADERS,
      cache: "no-store",
    })
    if (!response.ok) return null

    const data = (await response.json()) as {
      address?: {
        road?: string
        house_number?: string
        suburb?: string
        neighbourhood?: string
        city?: string
        town?: string
        village?: string
        municipality?: string
        state?: string
        postcode?: string
      }
    }
    const address = data.address
    if (!address) return null

    return {
      street: address.road ?? null,
      number: address.house_number ?? null,
      neighborhood:
        address.suburb ?? address.neighbourhood ?? null,
      city:
        address.city ??
        address.town ??
        address.village ??
        address.municipality ??
        null,
      state: address.state ?? null,
      postcode: address.postcode ?? null,
    }
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

export type AddressParts = {
  street?: string | null
  number?: string | null
  neighborhood?: string | null
  city?: string | null
  state?: string | null
  postcode?: string | null
}

/**
 * Normaliza o nome da UF para a sigla de 2 letras: "São Paulo" → "SP".
 * Já vindo em sigla (ex.: ViaCEP devolve "SP"), retorna como está.
 * Usado para uniformizar o campo de estado vindo do GPS (Nominatim) e do CEP.
 */
export function normalizeUf(value?: string | null): string {
  const raw = (value ?? "").trim()
  if (!raw) return ""
  const upper = raw.toUpperCase()
  if (/^[A-Z]{2}$/.test(upper)) return upper
  const UF_MAP: Record<string, string> = {
    ACRE: "AC",
    ALAGOAS: "AL",
    AMAPÁ: "AP",
    AMAZONAS: "AM",
    BAHIA: "BA",
    CEARÁ: "CE",
    "DISTRITO FEDERAL": "DF",
    "ESPÍRITO SANTO": "ES",
    GOIÁS: "GO",
    MARANHÃO: "MA",
    "MATO GROSSO": "MT",
    "MATO GROSSO DO SUL": "MS",
    "MINAS GERAIS": "MG",
    PARÁ: "PA",
    PARAÍBA: "PB",
    PARANÁ: "PR",
    PERNAMBUCO: "PE",
    PIAUÍ: "PI",
    "RIO DE JANEIRO": "RJ",
    "RIO GRANDE DO NORTE": "RN",
    "RIO GRANDE DO SUL": "RS",
    RONDÔNIA: "RO",
    RORAIMA: "RR",
    "SANTA CATARINA": "SC",
    "SÃO PAULO": "SP",
    SERGIPE: "SE",
    TOCANTINS: "TO",
  }
  return UF_MAP[upper] ?? raw
}
export function buildAddress(parts: AddressParts): string {
  const street =
    parts.street && parts.number
      ? `${parts.street}, ${parts.number}`
      : (parts.street ?? "")
  return [street, parts.neighborhood, parts.city, parts.state]
    .filter(Boolean)
    .join(", ")
}
