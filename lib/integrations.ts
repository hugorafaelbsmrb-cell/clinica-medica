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
