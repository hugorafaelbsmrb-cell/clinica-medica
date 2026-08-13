/**
 * Credenciais de integrações externas (DeepSeek e W-API).
 *
 * O admin configura tudo pela tela Configurações → Integrações, salvo no
 * banco (tabela ClinicSettings). As variáveis de ambiente do .env continuam
 * funcionando como fallback — úteis quando a chave não deve ficar no banco.
 */
import { prisma } from "@/lib/prisma"

export type IntegrationSettings = {
  deepseekApiKey: string
  wApiInstance: string
  wApiToken: string
}

let cache: IntegrationSettings | null = null

/** Carrega as credenciais de integração (banco primeiro, .env como fallback). */
export async function getIntegrationSettings(): Promise<IntegrationSettings> {
  if (cache) return cache

  const settings = await prisma.clinicSettings.findUnique({ where: { id: 1 } })
  cache = {
    deepseekApiKey:
      settings?.deepseekApiKey || process.env.DEEPSEEK_API_KEY || "",
    wApiInstance: settings?.wApiInstance || process.env.W_API_INSTANCE || "",
    wApiToken: settings?.wApiToken || process.env.W_API_TOKEN || "",
  }
  return cache
}

/** Invalida o cache após o admin salvar novas credenciais. */
export function invalidateIntegrationCache(): void {
  cache = null
}

/** Testa a chave da DeepSeek chamando GET /models (valida a autenticação). */
export async function testDeepSeekConnection(
  apiKey: string
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch("https://api.deepseek.com/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        message: "Chave inválida — a DeepSeek recusou a autenticação",
      }
    }
    if (!response.ok) {
      return { success: false, message: `DeepSeek respondeu ${response.status}` }
    }
    return { success: true, message: "Chave válida — conexão com a DeepSeek OK" }
  } catch {
    return {
      success: false,
      message: "Falha ao conectar na DeepSeek. Verifique sua internet.",
    }
  }
}

/**
 * Testa as credenciais da W-API chamando o endpoint de validação de número,
 * que exige instanceId + token e confirma a conexão da instância.
 */
export async function testWApiConnection(
  instanceId: string,
  token: string
): Promise<{ success: boolean; message: string }> {
  try {
    const url = `https://api.w-api.app/v1/contacts/phone-exists?instanceId=${encodeURIComponent(instanceId)}&phoneNumber=5511999990000`
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    })

    const text = await response.text()
    let data: { message?: string; error?: string } = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = {}
    }

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        message: "Autenticação recusada — confira o ID da instância e o token",
      }
    }
    if (response.ok) {
      return {
        success: true,
        message: "Conexão com a W-API OK — credenciais válidas",
      }
    }

    const detail = data.message ?? data.error ?? ""
    return {
      success: false,
      message: `W-API respondeu ${response.status}${detail ? `: ${detail}` : ""}`,
    }
  } catch {
    return {
      success: false,
      message: "Falha ao conectar na W-API. Verifique sua internet.",
    }
  }
}

export type WApiConnectResult = {
  success: boolean
  message: string
  pairingCode?: string
  qrcode?: string
}

/**
 * Gera o código de pareamento da instância — conexão por telefone.
 * GET /instance/pairing-code?instanceId=...&phoneNumber=...
 * O usuário digita o código no WhatsApp do celular (Aparelhos conectados
 * → Conectar aparelho → Conectar com número de telefone).
 */
export async function getWApiPairingCode(
  instanceId: string,
  token: string,
  phoneNumber: string
): Promise<WApiConnectResult> {
  try {
    const url = `https://api.w-api.app/v1/instance/pairing-code?instanceId=${encodeURIComponent(instanceId)}&phoneNumber=${encodeURIComponent(phoneNumber)}`
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    })

    const text = await response.text()
    let data: { error?: boolean; message?: string; pairingCode?: string } = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = {}
    }

    if (!response.ok || data.error) {
      return {
        success: false,
        message: data.message ?? `W-API respondeu ${response.status}`,
      }
    }
    if (!data.pairingCode) {
      return {
        success: false,
        message: "A W-API não retornou o código de pareamento.",
      }
    }
    return {
      success: true,
      message: "Código gerado com sucesso",
      pairingCode: data.pairingCode,
    }
  } catch {
    return {
      success: false,
      message: "Falha ao conectar na W-API. Verifique sua internet.",
    }
  }
}

/**
 * Gera o QR code da instância em base64 (data URL pronto para <img>).
 * GET /instance/qr-code?instanceId=...&image=disable
 * O código expira em cerca de 20 segundos; se já houver conexão ativa,
 * a W-API recusa gerar um novo QR.
 */
export async function getWApiQrCode(
  instanceId: string,
  token: string
): Promise<WApiConnectResult> {
  try {
    const url = `https://api.w-api.app/v1/instance/qr-code?instanceId=${encodeURIComponent(instanceId)}&image=disable`
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    })

    const text = await response.text()
    let data: { error?: boolean; message?: string; qrcode?: string } = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = {}
    }

    if (!response.ok || data.error) {
      return {
        success: false,
        message: data.message ?? `W-API respondeu ${response.status}`,
      }
    }
    if (!data.qrcode) {
      return {
        success: false,
        message: "A W-API não retornou o QR code.",
      }
    }
    return {
      success: true,
      message: "QR code gerado",
      qrcode: data.qrcode,
    }
  } catch {
    return {
      success: false,
      message: "Falha ao conectar na W-API. Verifique sua internet.",
    }
  }
}
