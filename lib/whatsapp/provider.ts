/**
 * Interface do provedor de WhatsApp (arquitetura adapter).
 *
 * O sistema funciona com qualquer provedor que implemente esta interface:
 * hoje temos o MockProvider (desenvolvimento) e o WApiProvider (produção).
 * Para ativar o W-API, configure as credenciais em Configurações →
 * Integrações (ou W_API_TOKEN e W_API_INSTANCE no .env).
 */

import { getIntegrationSettings } from "@/lib/integrations"
import { MockProvider } from "./mock-provider"
import { WApiProvider } from "./wapi-provider"

export type SendResult = {
  ok: boolean
  providerMessageId?: string
  error?: string
}

export type PhoneValidationResult = {
  ok: boolean
  /** true = o número está registrado no WhatsApp. */
  exists?: boolean
  error?: string
}

export type WhatsAppIncoming = {
  from: string // número do remetente (ex.: 5511999990000)
  content: string
  receivedAt: Date
  providerMessageId?: string
}

export interface WhatsAppProvider {
  readonly name: string
  /** Envia mensagem de texto para o número informado (com DDI, ex.: 5511999990000). */
  sendText(phone: string, message: string): Promise<SendResult>
  /** Envia um documento (PDF) com legenda. */
  sendDocument(
    phone: string,
    caption: string,
    document: Buffer,
    fileName: string
  ): Promise<SendResult>
  /**
   * Envia uma imagem (data URL PNG/JPEG) com legenda. Opcional: quando o
   * provedor não implementa mídia, o chamador cai para texto puro.
   */
  sendImage?(
    phone: string,
    caption: string,
    imageDataUrl: string
  ): Promise<SendResult>
  /** Valida se um número está registrado no WhatsApp. */
  validatePhone(phone: string): Promise<PhoneValidationResult>
  /**
   * Processa o payload de um webhook recebido do provedor
   * e devolve as mensagens recebidas em formato padronizado.
   */
  parseWebhook(payload: unknown): Promise<WhatsAppIncoming[]>
}

/** Provedor ativo com base nas credenciais configuradas (banco ou .env). */
export async function getWhatsAppProvider(): Promise<WhatsAppProvider> {
  const settings = await getIntegrationSettings()
  if (settings.wApiToken && settings.wApiInstance) {
    return new WApiProvider(settings.wApiInstance, settings.wApiToken)
  }
  return new MockProvider()
}

/** Normaliza número de telefone: mantém apenas dígitos, garante DDI 55. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.length <= 11) {
    return `55${digits}`
  }
  return digits
}

