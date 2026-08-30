"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { encryptSecret } from "@/lib/signing/crypto"
import {
  getIntegrationSettings,
  getWApiConnectionStatus,
  getWApiPairingCode,
  getWApiQrCode,
  invalidateIntegrationCache,
  testDeepSeekConnection,
  testWApiConnection,
} from "@/lib/integrations"

export type ActionState = {
  success: boolean
  message: string
}

/** Ambientes aceitos no seletor do painel (allowlist da API Bird ID). */
const BIRDID_BASE_URLS = [
  "https://apihom.birdid.com.br",
  "https://api.birdid.com.br",
]

const integrationsSchema = z.object({
  deepseekApiKey: z.string().optional(),
  wApiInstance: z.string().optional(),
  wApiToken: z.string().optional(),
  birdIdBaseUrl: z.string().optional(),
  birdIdClientId: z.string().optional(),
  birdIdClientSecret: z.string().optional(),
})

/**
 * Salva as credenciais de integração (DeepSeek + W-API + Bird ID) no
 * registro da clínica (id = 1). Campos vazios removem a credencial salva —
 * exceção: o client_secret do Bird ID só é sobrescrito quando preenchido
 * (fica criptografado e não volta para a tela).
 */
export async function saveIntegrations(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return {
      success: false,
      message: "Apenas administradores podem alterar as integrações",
    }
  }

  const parsed = integrationsSchema.safeParse({
    deepseekApiKey: formData.get("deepseekApiKey"),
    wApiInstance: formData.get("wApiInstance"),
    wApiToken: formData.get("wApiToken"),
    birdIdBaseUrl: formData.get("birdIdBaseUrl"),
    birdIdClientId: formData.get("birdIdClientId"),
    birdIdClientSecret: formData.get("birdIdClientSecret"),
  })

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }

  const data = parsed.data
  const birdIdBaseUrl = data.birdIdBaseUrl?.trim().replace(/\/+$/, "") || null
  if (birdIdBaseUrl && !BIRDID_BASE_URLS.includes(birdIdBaseUrl)) {
    return { success: false, message: "Ambiente do Bird ID inválido" }
  }
  const birdIdClientSecret = data.birdIdClientSecret?.trim()
  const secretEnc = birdIdClientSecret ? encryptSecret(birdIdClientSecret) : null

  const base = {
    deepseekApiKey: data.deepseekApiKey?.trim() || null,
    wApiInstance: data.wApiInstance?.trim() || null,
    wApiToken: data.wApiToken?.trim() || null,
    birdIdBaseUrl,
    birdIdClientId: data.birdIdClientId?.trim() || null,
  }
  await prisma.clinicSettings.upsert({
    where: { id: 1 },
    update: { ...base, ...(secretEnc ? { birdIdClientSecretEnc: secretEnc } : {}) },
    create: { id: 1, ...base, birdIdClientSecretEnc: secretEnc },
  })

  invalidateIntegrationCache()

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "ClinicSettings",
      entityId: "integracoes",
    },
  })

  revalidatePath("/", "layout")
  return { success: true, message: "Integrações salvas" }
}

/**
 * Testa a conexão de uma integração usando os valores informados no
 * formulário. Os campos já vêm preenchidos com as credenciais salvas.
 */
export async function testIntegration(input: {
  service: "deepseek" | "wapi"
  deepseekApiKey?: string
  wApiInstance?: string
  wApiToken?: string
}): Promise<ActionState> {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return {
      success: false,
      message: "Apenas administradores podem testar as integrações",
    }
  }

  if (input.service === "deepseek") {
    const key = input.deepseekApiKey?.trim()
    if (!key) {
      return {
        success: false,
        message: "Informe a chave da DeepSeek para testar",
      }
    }
    return testDeepSeekConnection(key)
  }

  const instance = input.wApiInstance?.trim()
  const token = input.wApiToken?.trim()
  if (!instance || !token) {
    return {
      success: false,
      message: "Preencha o ID da instância e o token da W-API para testar",
    }
  }
  return testWApiConnection(instance, token)
}

export type ConnectResult = {
  success: boolean
  message: string
  pairingCode?: string
  qrcode?: string
  connected?: boolean
}

/** Credenciais salvas da W-API (a conexão usa o que está no banco). */
async function savedWApiCredentials(): Promise<
  | { ok: true; instance: string; token: string }
  | { ok: false; message: string }
> {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return {
      ok: false,
      message: "Apenas administradores podem conectar o WhatsApp",
    }
  }
  const settings = await getIntegrationSettings()
  if (!settings.wApiInstance || !settings.wApiToken) {
    return {
      ok: false,
      message:
        "Salve o ID da instância e o token da W-API antes de conectar o WhatsApp",
    }
  }
  return { ok: true, instance: settings.wApiInstance, token: settings.wApiToken }
}

/**
 * Gera o código de pareamento usando as credenciais salvas.
 * O número informado vira digits com DDI 55 quando necessário.
 */
export async function generatePairingCode(
  phoneNumber: string
): Promise<ConnectResult> {
  const creds = await savedWApiCredentials()
  if (!creds.ok) return { success: false, message: creds.message }

  const digits = phoneNumber.replace(/\D/g, "")
  if (digits.length < 10) {
    return {
      success: false,
      message:
        "Informe o número do WhatsApp com DDI e DDD (ex.: 5594999999999)",
    }
  }
  const normalized = digits.length <= 11 ? `55${digits}` : digits

  return getWApiPairingCode(creds.instance, creds.token, normalized)
}

/** Gera o QR code de conexão usando as credenciais salvas. */
export async function generateQrCode(): Promise<ConnectResult> {
  const creds = await savedWApiCredentials()
  if (!creds.ok) return { success: false, message: creds.message }
  return getWApiQrCode(creds.instance, creds.token)
}

/** Verifica o status da conexão da instância (conectada/desconectada). */
export async function checkWhatsAppConnection(): Promise<ConnectResult> {
  const creds = await savedWApiCredentials()
  if (!creds.ok) return { success: false, message: creds.message }
  return getWApiConnectionStatus(creds.instance, creds.token)
}
