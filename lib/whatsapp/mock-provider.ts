/**
 * MockProvider: simula o envio de mensagens em desenvolvimento.
 * Registra a "entrega" no console e considera tudo como enviado com sucesso,
 * permitindo testar todos os fluxos sem contratar o serviço real.
 */
import type {
  PhoneValidationResult,
  SendResult,
  WhatsAppButton,
  WhatsAppIncoming,
  WhatsAppOutgoing,
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

  async sendImage(
    phone: string,
    caption: string,
    imageDataUrl: string
  ): Promise<SendResult> {
    console.log(
      `[WhatsApp MOCK] Enviando imagem para ${phone} (${imageDataUrl.length} chars) — ${caption}`
    )
    return {
      ok: true,
      providerMessageId: `mock-img-${Date.now()}`,
    }
  }

  async sendVideo(
    phone: string,
    videoUrl: string,
    caption: string
  ): Promise<SendResult> {
    console.log(
      `[WhatsApp MOCK] Enviando vídeo para ${phone} (${videoUrl}) — ${caption}`
    )
    return {
      ok: true,
      providerMessageId: `mock-video-${Date.now()}`,
    }
  }

  async sendTextWithButtons(
    phone: string,
    message: string,
    buttons: WhatsAppButton[]
  ): Promise<SendResult> {
    console.log(
      `[WhatsApp MOCK] Enviando para ${phone} com ${buttons.length} botão(ões): ${message}`
    )
    return {
      ok: true,
      providerMessageId: `mock-btns-${Date.now()}`,
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

  async parseOutgoing(): Promise<WhatsAppOutgoing[]> {
    return []
  }
}
