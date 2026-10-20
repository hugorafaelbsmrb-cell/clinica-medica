/**
 * Webhook do WhatsApp: recebe respostas dos pacientes, registra no
 * prontuário e responde automaticamente pelo bot de atendimento.
 * Também detecta mensagens enviadas pela equipe a partir do próprio
 * WhatsApp (fromMe = true) e pausa o bot daquela conversa.
 * URL para configurar no painel da W-API: /api/webhooks/whatsapp
 */
import { NextRequest, NextResponse } from "next/server"
import {
  getWhatsAppProvider,
  isValidIndividualPhone,
} from "@/lib/whatsapp/provider"
import { registerIncoming } from "@/lib/whatsapp/message-service"
import { handleBotMessage } from "@/lib/whatsapp/bot-service"
import {
  pauseBotForPhone,
  pauseFromWhatsAppOutgoing,
} from "@/lib/whatsapp/bot-pause"

export const runtime = "nodejs"

/**
 * Mapa LID → telefone, alimentado pelos eventos recebidos (o WhatsApp
 * identifica contatos por @lid em parte das conversas). Serve para pausar
 * o bot quando a equipe responde pelo celular em conversas que só expõem o
 * LID no evento de entrega.
 */
const lidGlobal = globalThis as unknown as { lidToPhone?: Map<string, string> }
const lidToPhone: Map<string, string> = (lidGlobal.lidToPhone ??= new Map())

export async function POST(request: NextRequest) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 })
  }

  // Eventos que não são mensagem recebida (webhookDelivery, webhookReceived
  // com fromMe=true, webhookDisconnected etc.): loga para diagnóstico da
  // entrega (sucesso/falha de envios) — parseWebhook já ignora a maioria.
  const eventName = (payload as { event?: string }).event

  // DIAGNÓSTICO TEMPORÁRIO (investigação "bot não para ao assumir"):
  // registra os campos-chave e o payload cru dos eventos de conversa (exceto
  // "status") para identificar o formato real dos eventos enviados pela
  // equipe pelo celular e dos envios feitos via API.
  if (eventName === "webhookReceived") {
    const p = payload as {
      fromMe?: unknown
      fromApi?: unknown
      isGroup?: unknown
      chat?: { id?: string }
      sender?: { id?: string }
      msgContent?: Record<string, unknown>
    }
    console.log(
      `[wa-diag] fromMe=${JSON.stringify(p.fromMe)} fromApi=${JSON.stringify(p.fromApi)} isGroup=${JSON.stringify(p.isGroup)} chat=${JSON.stringify(p.chat?.id ?? null)} sender=${JSON.stringify(p.sender?.id ?? null)} msgKeys=${Object.keys(p.msgContent ?? {}).join("|")}`
    )
    if (p.chat?.id !== "status") {
      console.log(`[wa-diag-payload] ${JSON.stringify(payload).slice(0, 1500)}`)
    }
    // Registra o LID da conversa para resolver o destinatário nos eventos
    // de entrega (webhookDelivery).
    const chatId = p.chat?.id ?? ""
    const senderId = (p.sender?.id ?? "").split("@")[0]
    if (chatId.endsWith("@lid") && isValidIndividualPhone(senderId)) {
      lidToPhone.set(chatId, senderId)
    }
  }

  if (eventName && eventName !== "webhookReceived") {
    console.log(
      `[WhatsApp Webhook] ${eventName}: ${JSON.stringify(payload).slice(0, 2500)}`
    )
  }

  // A W-API entrega o MESMO evento duas vezes (dois IPs, ~1s de diferença).
  // Sem deduplicação o bot responde em dobro à mesma mensagem e duplica o
  // registro no painel. Guarda os messageId já processados por 10 min.
  const dedupeGlobal = globalThis as unknown as {
    processedWebhookIds?: Map<string, number>
  }
  const processedIds: Map<string, number> = (dedupeGlobal.processedWebhookIds ??= new Map())
  const messageId = (payload as { messageId?: string }).messageId
  if (messageId) {
    const now = Date.now()
    if (processedIds.size > 5000) {
      for (const [id, at] of processedIds) {
        if (now - at > 10 * 60_000) processedIds.delete(id)
      }
    }
    if (processedIds.has(messageId)) {
      return NextResponse.json({ ok: true, duplicate: true })
    }
    processedIds.set(messageId, now)
  }

  const provider = await getWhatsAppProvider()

  // Evento de entrega: a W-API avisa toda mensagem que sai do número.
  // Quando o envio partiu do celular vinculado (fromApi = false), a equipe
  // assumiu a conversa pelo WhatsApp → pausa o bot daquele número.
  if (eventName === "webhookDelivery") {
    const deliveries = provider.parseDelivery
      ? await provider.parseDelivery(payload)
      : []
    for (const delivery of deliveries) {
      const phone =
        delivery.to ||
        (delivery.toLid ? lidToPhone.get(delivery.toLid) ?? "" : "")
      console.log(
        `[wa-delivery] fromApi=${delivery.fromApi} to=${JSON.stringify(phone)} lid=${JSON.stringify(delivery.toLid)}`
      )
      if (delivery.fromApi) continue
      if (!isValidIndividualPhone(phone)) {
        console.log("[wa-delivery] destinatário não resolvido — pausa ignorada")
        continue
      }
      await pauseBotForPhone(phone, "atendimento_humano")
      console.log(`[bot-pause] pausado via webhookDelivery (${phone})`)
    }
  }

  const messages = await provider.parseWebhook(payload)
  const outgoing = await provider.parseOutgoing(payload)

  // Envios feitos pela equipe fora do painel → pausa o bot da conversa.
  for (const message of outgoing) {
    await pauseFromWhatsAppOutgoing(message.to, message.content, message.sentAt)
  }

  for (const message of messages) {
    const messageId = await registerIncoming(
      message.from,
      message.content,
      message.receivedAt
    )
    await handleBotMessage(message.from, message.content, messageId)
  }

  return NextResponse.json({ ok: true, received: messages.length })
}
