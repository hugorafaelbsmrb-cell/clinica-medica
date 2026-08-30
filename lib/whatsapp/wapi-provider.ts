/**
 * WApiProvider: integração real com o serviço W-API (https://w-api.app).
 * Documentação oficial: https://docs.w-api.app
 *
 * Credenciais (configuradas em Configurações → Integrações, ou no .env):
 *  - instanceId: ID da instância, enviado como query param (?instanceId=...)
 *  - token: enviado no header `Authorization: Bearer <token>`
 *
 * Endpoints usados (base https://api.w-api.app/v1):
 *  - POST /message/send-text     → body { phone, message }
 *  - POST /message/send-document → body { phone, document (base64|URL), extension, fileName, caption }
 *  - POST /message/send-image    → body { phone, image (base64), caption }
 *  - POST /message/send-button-actions → body { phone, message, buttonActions: [{ type, buttonText, url|phone }] }
 *  - GET  /contacts/phone-exists → query { phoneNumber } → { exists: boolean, phoneNumber, lid }
 *  - Webhook de mensagem recebida → evento "webhookReceived"
 */
import type {
  PhoneValidationResult,
  SendResult,
  WhatsAppButton,
  WhatsAppIncoming,
  WhatsAppOutgoing,
  WhatsAppProvider,
} from "./provider"

const API_BASE = "https://api.w-api.app/v1"

type WApiSuccess = {
  instanceId?: string
  messageId?: string
  insertedId?: string
}

type WApiError = {
  message?: string
  error?: string
}

export class WApiProvider implements WhatsAppProvider {
  readonly name = "wapi"

  constructor(
    private readonly instanceId: string,
    private readonly token: string
  ) {}

  private buildUrl(path: string): string {
    return `${API_BASE}${path}?instanceId=${encodeURIComponent(this.instanceId)}`
  }

  /** Executa um POST JSON na W-API e normaliza o resultado. */
  private async post(
    path: string,
    body: Record<string, unknown>
  ): Promise<SendResult> {
    try {
      const response = await fetch(this.buildUrl(path), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
      })

      const text = await response.text()
      let data: WApiSuccess & WApiError = {}
      try {
        data = text ? (JSON.parse(text) as WApiSuccess & WApiError) : {}
      } catch {
        data = {}
      }

      if (!response.ok) {
        const detail = data.message ?? data.error ?? text
        return {
          ok: false,
          error: `W-API respondeu ${response.status}${detail ? `: ${detail}` : ""}`,
        }
      }

      // Sucesso: 200 com { instanceId, messageId, insertedId }
      return { ok: true, providerMessageId: data.messageId ?? data.insertedId }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Falha ao chamar W-API",
      }
    }
  }

  async sendText(phone: string, message: string): Promise<SendResult> {
    return this.post("/message/send-text", { phone, message })
  }

  /**
   * POST /message/send-button-actions (plano PRO da W-API): envia o texto
   * com botões de ação, ex.: botão URL que abre o link de pagamento direto
   * no WhatsApp. Máximo 3 botões por mensagem.
   */
  async sendTextWithButtons(
    phone: string,
    message: string,
    buttons: WhatsAppButton[]
  ): Promise<SendResult> {
    return this.post("/message/send-button-actions", {
      phone,
      message,
      buttonActions: buttons.slice(0, 3).map((button) => ({
        type: button.type,
        buttonText: button.label,
        ...(button.type === "URL" ? { url: button.url } : {}),
        ...(button.type === "CALL" ? { phone: button.phone } : {}),
      })),
    })
  }

  async sendDocument(
    phone: string,
    caption: string,
    document: Buffer,
    fileName: string
  ): Promise<SendResult> {
    const extension = fileName.includes(".")
      ? (fileName.split(".").pop()?.toLowerCase() ?? "pdf")
      : "pdf"

    return this.post("/message/send-document", {
      phone,
      document: document.toString("base64"),
      extension,
      fileName,
      caption,
    })
  }

  /**
   * POST /message/send-image → body { phone, image (base64), caption }.
   * Segue a convenção do send-document (base64 sem o prefixo data URL).
   */
  async sendImage(
    phone: string,
    caption: string,
    imageDataUrl: string
  ): Promise<SendResult> {
    const base64 = imageDataUrl.includes(",") ? imageDataUrl.split(",")[1] ?? "" : imageDataUrl
    return this.post("/message/send-image", {
      phone,
      image: base64,
      caption,
    })
  }

  /**
   * GET /contacts/phone-exists?instanceId=...&phoneNumber=...
   * Resposta 200: { exists: boolean, phoneNumber, lid }
   */
  async validatePhone(phone: string): Promise<PhoneValidationResult> {
    try {
      const url = `${this.buildUrl("/contacts/phone-exists")}&phoneNumber=${encodeURIComponent(phone)}`
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.token}` },
      })

      const text = await response.text()
      let data: { exists?: boolean } & WApiError = {}
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        data = {}
      }

      if (!response.ok) {
        const detail = data.message ?? data.error ?? text
        return {
          ok: false,
          error: `W-API respondeu ${response.status}${detail ? `: ${detail}` : ""}`,
        }
      }

      return { ok: true, exists: data.exists === true }
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error ? error.message : "Falha ao validar número na W-API",
      }
    }
  }

  /** Extrai o texto de uma mensagem (texto puro ou estendido) do payload. */
  private extractText(msgContent?: {
    conversation?: string
    extendedTextMessage?: { text?: string }
    message?: {
      conversation?: string
      extendedTextMessage?: { text?: string }
    }
  }): string {
    return (
      msgContent?.conversation ??
      msgContent?.extendedTextMessage?.text ??
      msgContent?.message?.conversation ??
      msgContent?.message?.extendedTextMessage?.text ??
      ""
    )
  }

  async parseWebhook(payload: unknown): Promise<WhatsAppIncoming[]> {
    // Formato real do webhook da W-API (evento de mensagem recebida):
    // {
    //   event: "webhookReceived", fromMe: false,
    //   chat: { id: "5511999999999" },       // chat (contato ou grupo)
    //   sender: { id: "5511999999999" },     // remetente real da mensagem
    //   msgContent: { conversation | extendedTextMessage: { text } },
    //   moment: 1769087122                   // timestamp em segundos
    // }
    const body = payload as {
      event?: string
      fromMe?: boolean
      chat?: { id?: string }
      sender?: { id?: string }
      msgContent?: {
        conversation?: string
        extendedTextMessage?: { text?: string }
        message?: {
          conversation?: string
          extendedTextMessage?: { text?: string }
        }
      }
      moment?: number
    }

    // Ignora eventos de entrega/desconexão e mensagens enviadas por nós mesmos.
    if (body.event !== "webhookReceived" || body.fromMe) {
      return []
    }

    const from = (body.sender?.id ?? body.chat?.id ?? "").split("@")[0]
    const content = this.extractText(body.msgContent)

    if (!from || !content) {
      return []
    }

    const moment = Number(body.moment)
    return [
      {
        from,
        content,
        receivedAt: moment > 0 ? new Date(moment * 1000) : new Date(),
      },
    ]
  }

  /**
   * Mensagens que PARTIRAM do número (fromMe = true): a W-API também
   * dispara o webhook quando alguém envia pelo WhatsApp vinculado à
   * instância (ex.: a equipe respondendo ao paciente fora do painel).
   */
  async parseOutgoing(payload: unknown): Promise<WhatsAppOutgoing[]> {
    const body = payload as {
      event?: string
      fromMe?: boolean
      chat?: { id?: string }
      msgContent?: {
        conversation?: string
        extendedTextMessage?: { text?: string }
        message?: {
          conversation?: string
          extendedTextMessage?: { text?: string }
        }
      }
      moment?: number
    }

    if (body.event !== "webhookReceived" || !body.fromMe) {
      return []
    }

    // Chat da conversa = destinatário. Ignora grupos e transmissões.
    const chatId = body.chat?.id ?? ""
    const to = chatId.split("@")[0]
    if (!to || chatId.includes("g.us") || chatId.includes("broadcast")) {
      return []
    }

    const moment = Number(body.moment)
    return [
      {
        to,
        content: this.extractText(body.msgContent),
        sentAt: moment > 0 ? new Date(moment * 1000) : new Date(),
      },
    ]
  }
}
