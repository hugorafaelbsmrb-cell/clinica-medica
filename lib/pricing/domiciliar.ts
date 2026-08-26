/**
 * Precificação domiciliar por raio de distância.
 *
 * Referência = localização da clínica (Configurações → Clínica) e raio
 * urbano em km (Configurações → Pagamentos). Paciente dentro do raio paga
 * consultaPrecoDomiciliar; fora, consultaPrecoDomiciliarFora. Sem ponto de
 * referência configurado, vale o preço único (comportamento anterior).
 */
import { prisma } from "@/lib/prisma"
import { getClinicSettings } from "@/lib/clinic"
import {
  buildAddress,
  geocodeAddress,
  haversineKm,
  type LatLng,
} from "@/lib/geo"

export type DomiciliarZone = "URBANO" | "FORA"

export type DomiciliarPriceResult =
  | {
      ok: true
      price: number
      distanceKm: number | null
      zone: DomiciliarZone | null
    }
  | { ok: false; reason: "SEM_LOCALIZACAO"; message: string }

/** Campos mínimos do paciente para resolver a localização do domicílio. */
export type PatientLocationLike = {
  id: string
  latitude: number | null
  longitude: number | null
  street: string | null
  number: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
}

/**
 * Coordenadas do paciente: usa o cadastro se existir; senão geocodifica o
 * endereço registrado (Nominatim, via lib/geo) e persiste para reuso.
 */
export async function resolvePatientCoordinates(
  patient: PatientLocationLike
): Promise<LatLng | null> {
  if (patient.latitude != null && patient.longitude != null) {
    return { latitude: patient.latitude, longitude: patient.longitude }
  }

  const address = buildAddress({
    street: patient.street,
    number: patient.number,
    neighborhood: patient.neighborhood,
    city: patient.city,
    state: patient.state,
  })
  if (address.length < 8) return null

  const coords = await geocodeAddress(address)
  if (!coords) return null

  await prisma.patient.update({
    where: { id: patient.id },
    data: {
      latitude: coords.latitude,
      longitude: coords.longitude,
      locationSource: "GEOCODE",
      locationUpdatedAt: new Date(),
    },
  })
  return coords
}

export type DomiciliarPrice = {
  price: number
  distanceKm: number | null
  zone: DomiciliarZone | null
}

/** Configuração da clínica necessária ao cálculo do preço por raio. */
export type DomiciliarPriceConfig = {
  basePrice: number
  outsidePrice: number
  clinicCoords: LatLng | null
  radiusKm: number | null
}

/**
 * Cálculo puro (sem banco): preço, distância e zona a partir das
 * coordenadas do paciente. Clínica sem referência/raio configurado →
 * preço base único (comportamento anterior). Sem preço base → sem cobrança.
 */
export function resolveDomiciliarZone(
  config: DomiciliarPriceConfig,
  patientCoords: LatLng
): DomiciliarPrice {
  // Sem preço base → agendamento sem cobrança antecipada (fluxo atual).
  if (config.basePrice <= 0) {
    return { price: 0, distanceKm: null, zone: null }
  }

  if (!config.clinicCoords || !config.radiusKm) {
    return { price: config.basePrice, distanceKm: null, zone: null }
  }

  const distanceKm = haversineKm(config.clinicCoords, patientCoords)
  const zone: DomiciliarZone = distanceKm <= config.radiusKm ? "URBANO" : "FORA"

  return {
    price: zone === "URBANO" ? config.basePrice : config.outsidePrice,
    distanceKm: Math.round(distanceKm * 10) / 10,
    zone,
  }
}

/**
 * Preço para coordenadas já conhecidas (form interno com GPS/geocode).
 * Clínica sem referência configurada → preço base único (comportamento atual).
 */
export async function priceFromCoordinates(
  coords: LatLng
): Promise<DomiciliarPrice> {
  const clinic = await getClinicSettings()
  const basePrice = clinic.consultaPrecoDomiciliar ?? 0
  const outsidePrice = clinic.consultaPrecoDomiciliarFora ?? basePrice
  const clinicCoords =
    clinic.latitude != null && clinic.longitude != null
      ? { latitude: clinic.latitude, longitude: clinic.longitude }
      : null
  const radius =
    clinic.raioUrbanoKm != null && clinic.raioUrbanoKm > 0
      ? clinic.raioUrbanoKm
      : null

  return resolveDomiciliarZone(
    { basePrice, outsidePrice, clinicCoords, radiusKm: radius },
    coords
  )
}

/**
 * Calcula preço, distância e zona do atendimento domiciliar.
 * Sem cobrança configurada (preço base 0) não faz geocodificação nem
 * bloqueio — o fluxo continua confirmando na hora, como hoje.
 */
export async function computeDomiciliarPrice(
  patient: PatientLocationLike
): Promise<DomiciliarPriceResult> {
  const clinic = await getClinicSettings()
  const basePrice = clinic.consultaPrecoDomiciliar ?? 0

  // Sem preço base → agendamento sem cobrança antecipada (fluxo atual).
  if (basePrice <= 0) {
    return { ok: true, price: 0, distanceKm: null, zone: null }
  }

  const clinicCoords =
    clinic.latitude != null && clinic.longitude != null
      ? { latitude: clinic.latitude, longitude: clinic.longitude }
      : null
  const radius =
    clinic.raioUrbanoKm != null && clinic.raioUrbanoKm > 0
      ? clinic.raioUrbanoKm
      : null

  // Clínica sem referência configurada → preço único (comportamento atual).
  if (!clinicCoords || !radius) {
    return { ok: true, price: basePrice, distanceKm: null, zone: null }
  }

  const patientCoords = await resolvePatientCoordinates(patient)
  if (!patientCoords) {
    return {
      ok: false,
      reason: "SEM_LOCALIZACAO",
      message:
        "Não conseguimos calcular a distância até o seu endereço. Confira os dados do cadastro ou fale com a clínica.",
    }
  }

  return { ok: true, ...(await priceFromCoordinates(patientCoords)) }
}
