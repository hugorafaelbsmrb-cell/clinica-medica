/**
 * Camada de IA (arquitetura adapter).
 *
 * O sistema funciona 100% sem chave de IA: o médico escreve o resumo
 * manualmente. Com a chave da DeepSeek configurada (Configurações →
 * Integrações, ou DEEPSEEK_API_KEY no .env), o botão "Gerar com IA"
 * fica disponível. Trocar de provedor é só implementar AIProvider.
 */

import { getIntegrationSettings } from "@/lib/integrations"
import { DeepSeekProvider } from "./deepseek-provider"

export type AIResult = {
  ok: boolean
  content?: string
  error?: string
}

/** Opções de geração (opcionais; cada provider define padrões sensatos). */
export type AICompleteOptions = {
  /** Criatividade (0 = direto, 1+ = mais variado). Padrão: 0.4. */
  temperature?: number
  /** Limite de tokens da resposta. Padrão: 1000. */
  maxTokens?: number
}

export interface AIProvider {
  readonly name: string
  /** Envia um prompt e retorna o texto gerado. */
  complete(
    systemPrompt: string,
    userPrompt: string,
    options?: AICompleteOptions
  ): Promise<AIResult>
}

/** Indica se há algum provedor de IA configurado. */
export async function isAIEnabled(): Promise<boolean> {
  const settings = await getIntegrationSettings()
  return !!settings.deepseekApiKey
}

/** Provedor ativo. Hoje só DeepSeek; novos provedores entram aqui. */
export async function getAIProvider(): Promise<AIProvider | null> {
  const settings = await getIntegrationSettings()
  if (settings.deepseekApiKey) {
    return new DeepSeekProvider(settings.deepseekApiKey)
  }
  return null
}
