/**
 * MockProvider: simula o envio de mensagens em desenvolvimento.
 * Registra a "entrega" no console e considera tudo como enviado com sucesso,
 * permitindo testar todos os fluxos sem contratar o serviço real.
 */
import type {
  PhoneValidationResult,
  SendResult,
  WhatsAppIncoming,
  WhatsAppProvider,
} from "./provider"

export class MockProvider implements WhatsAppProvider {
  readonly name = "mock"

  async sendText(phone: string, message: string): Promise<SendResult> {
    console.log(`[WhatsApp MOCK] Enviando para ${phone}: ${message}`)
    return {
      ok: true,
      providerMessageId: `mock-${Date.now()}`,
    }
  }

  async sendDocument(
    phone: string,
    caption: string,
    document: Buffer,
    fileName: string
  ): Promise<SendResult> {
    console.log(
      `[WhatsApp MOCK] Enviando documento para ${phone}: ${fileName} (${document.length} bytes) — ${caption}`
    )
    return {
      ok: true,
      providerMessageId: `mock-doc-${Date.now()}`,
    }
  }

  async validatePhone(phone: string): Promise<PhoneValidationResult> {
    console.log(`[WhatsApp MOCK] Validando número ${phone}`)
    return { ok: true, exists: true }
  }

  async parseWebhook(payload: unknown): Promise<WhatsAppIncoming[]> {
    // Aceita formato simples: { from, content } ou { messages: [...] }
    const body = payload as {
      from?: string
      content?: string
      messages?: Array<{ from?: string; content?: string }>
    }

    if (body.messages) {
      return body.messages
        .filter((m) => m.from && m.content)
        .map((m) => ({
          from: m.from!,
          content: m.content!,
          receivedAt: new Date(),
        }))
    }

    if (body.from && body.content) {
      return [{ from: body.from, content: body.content, receivedAt: new Date() }]
    }

    return []
  }
}
