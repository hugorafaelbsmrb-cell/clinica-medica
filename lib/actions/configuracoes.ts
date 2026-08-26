"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { checkSignerHealth } from "@/lib/signing/signer-client"
import { geocodeAddress } from "@/lib/geo"

export type ActionState = {
  success: boolean
  message: string
}

const MAX_LOGO_BYTES = 1024 * 1024 // 1 MB

/** Converte um campo de coordenada (aceita vírgula) para número. */
function parseCoordinate(
  value: FormDataEntryValue | null,
  min: number,
  max: number
): number | null {
  const text = String(value ?? "").trim().replace(",", ".")
  if (!text) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null
}

/** Converte o campo de raio urbano (aceita vírgula) para km. */
function parseRadius(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim().replace(",", ".")
  if (!text) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const clinicSchema = z.object({
  name: z.string().min(2, "Informe o nome da clínica"),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z
    .union([z.string().email("E-mail inválido"), z.literal("")])
    .optional(),
  cnpj: z.string().optional(),
  horarioAtendimento: z.string().optional(),
  logoDataUrl: z.string().optional(),
  raioUrbanoKm: z.string().optional(),
})

/**
 * Salva as configurações da clínica (registro único, id = 1).
 * A logo chega como data URL (data:image/png;base64,...) — só PNG/JPEG,
 * pois o pdfkit não embute outros formatos.
 */
export async function saveClinicSettings(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return {
      success: false,
      message: "Apenas administradores podem alterar as configurações",
    }
  }

  const logoDataUrl = formData.get("logoDataUrl")?.toString() ?? ""
  const enableDigitalSignature = formData.get("enableDigitalSignature") === "on"
  const consultaPresencialEnabled = formData.get("consultaPresencialEnabled") === "on"
  const consultaDomiciliarEnabled = formData.get("consultaDomiciliarEnabled") === "on"
  const consultaTeleconsultaEnabled = formData.get("consultaTeleconsultaEnabled") === "on"

  if (logoDataUrl) {
    const isImage = /^data:image\/(png|jpe?g);base64,/.test(logoDataUrl)
    if (!isImage) {
      return {
        success: false,
        message: "Logo inválida — use uma imagem PNG ou JPEG",
      }
    }
    const base64 = logoDataUrl.split(",")[1] ?? ""
    const sizeBytes = Math.ceil((base64.length * 3) / 4)
    if (sizeBytes > MAX_LOGO_BYTES) {
      return {
        success: false,
        message: "Logo muito grande — use uma imagem de até 1 MB",
      }
    }
  }

  const parsed = clinicSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    cnpj: formData.get("cnpj"),
    horarioAtendimento: formData.get("horarioAtendimento"),
    logoDataUrl: logoDataUrl || undefined,
    raioUrbanoKm: formData.get("raioUrbanoKm"),
  })

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }

  const data = parsed.data
  const latitude = parseCoordinate(formData.get("latitude"), -90, 90)
  const longitude = parseCoordinate(formData.get("longitude"), -180, 180)
  const raioUrbanoKm = parseRadius(formData.get("raioUrbanoKm"))
  await prisma.clinicSettings.upsert({
    where: { id: 1 },
    update: {
      name: data.name,
      address: data.address || null,
      phone: data.phone || null,
      email: data.email || null,
      cnpj: data.cnpj || null,
      horarioAtendimento: data.horarioAtendimento || null,
      logoDataUrl: data.logoDataUrl || null,
      latitude,
      longitude,
      raioUrbanoKm,
      enableDigitalSignature,
      consultaPresencialEnabled,
      consultaDomiciliarEnabled,
      consultaTeleconsultaEnabled,
    },
    create: {
      id: 1,
      name: data.name,
      address: data.address || null,
      phone: data.phone || null,
      email: data.email || null,
      cnpj: data.cnpj || null,
      horarioAtendimento: data.horarioAtendimento || null,
      logoDataUrl: data.logoDataUrl || null,
      latitude,
      longitude,
      raioUrbanoKm,
      enableDigitalSignature,
      consultaPresencialEnabled,
      consultaDomiciliarEnabled,
      consultaTeleconsultaEnabled,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "ClinicSettings",
      entityId: "1",
    },
  })

  revalidatePath("/", "layout")
  return { success: true, message: "Configurações salvas" }
}

/**
 * Busca as coordenadas da clínica a partir do endereço (Nominatim) e
 * salva em ClinicSettings — referência do cálculo do raio urbano
 * domiciliar. Usa o endereço informado ou, sem ele, o salvo na clínica.
 */
export async function geocodeClinicAddress(address?: string): Promise<{
  success: boolean
  message: string
  latitude?: number
  longitude?: number
}> {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return {
      success: false,
      message: "Apenas administradores podem alterar as configurações",
    }
  }

  const clinic = await prisma.clinicSettings.findUnique({ where: { id: 1 } })
  const query = address?.trim() || clinic?.address?.trim() || ""
  if (!query) {
    return {
      success: false,
      message: "Informe o endereço da clínica antes de buscar as coordenadas",
    }
  }

  const coords = await geocodeAddress(query)
  if (!coords) {
    return {
      success: false,
      message:
        "Não foi possível localizar o endereço. Confira os dados e tente novamente.",
    }
  }

  await prisma.clinicSettings.update({
    where: { id: 1 },
    data: { latitude: coords.latitude, longitude: coords.longitude },
  })

  revalidatePath("/", "layout")
  return {
    success: true,
    message: "Coordenadas da clínica salvas",
    latitude: coords.latitude,
    longitude: coords.longitude,
  }
}

/** Saúde do microserviço de assinatura (exibida em Configurações). */
export async function getSignerStatus(): Promise<{ ok: boolean }> {
  return { ok: await checkSignerHealth() }
}

/**
 * Salva as configurações da automação (bot de atendimento do WhatsApp).
 * Campo vazio nas mensagens = usa a mensagem padrão do bot.
 */
export async function saveBotSettings(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return {
      success: false,
      message: "Apenas administradores podem alterar a automação",
    }
  }

  const botEnabled = formData.get("botEnabled") === "on"

  const botSchema = z.object({
    botMsgAtendente: z.string().max(2000).optional(),
    botMsgSaude: z.string().max(2000).optional(),
    botMsgCpfNaoEncontrado: z.string().max(2000).optional(),
    botMsgBoasVindas: z.string().max(2000).optional(),
    botMsgAgendar: z.string().max(2000).optional(),
  })
  const parsed = botSchema.safeParse({
    botMsgAtendente: formData.get("botMsgAtendente"),
    botMsgSaude: formData.get("botMsgSaude"),
    botMsgCpfNaoEncontrado: formData.get("botMsgCpfNaoEncontrado"),
    botMsgBoasVindas: formData.get("botMsgBoasVindas"),
    botMsgAgendar: formData.get("botMsgAgendar"),
  })
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }

  const data = parsed.data
  await prisma.clinicSettings.upsert({
    where: { id: 1 },
    update: {
      botEnabled,
      botMsgAtendente: data.botMsgAtendente?.trim() || null,
      botMsgSaude: data.botMsgSaude?.trim() || null,
      botMsgCpfNaoEncontrado: data.botMsgCpfNaoEncontrado?.trim() || null,
      botMsgBoasVindas: data.botMsgBoasVindas?.trim() || null,
      botMsgAgendar: data.botMsgAgendar?.trim() || null,
    },
    create: {
      id: 1,
      botEnabled,
      botMsgAtendente: data.botMsgAtendente?.trim() || null,
      botMsgSaude: data.botMsgSaude?.trim() || null,
      botMsgCpfNaoEncontrado: data.botMsgCpfNaoEncontrado?.trim() || null,
      botMsgBoasVindas: data.botMsgBoasVindas?.trim() || null,
      botMsgAgendar: data.botMsgAgendar?.trim() || null,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "ClinicSettings",
      entityId: "bot",
    },
  })

  revalidatePath("/", "layout")
  return { success: true, message: "Automação salva" }
}
