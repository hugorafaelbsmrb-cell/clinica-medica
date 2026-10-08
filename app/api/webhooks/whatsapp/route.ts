/**
 * Webhook do WhatsApp: recebe respostas dos pacientes, registra no
 * prontuário e responde automaticamente pelo bot de atendimento.
 * Também detecta mensagens enviadas pela equipe a partir do próprio
 * WhatsApp (fromMe = true) e pausa o bot daquela conversa.
 * URL para configurar no painel da W-API: /api/webhooks/whatsapp
 */
import { NextRequest, NextResponse } from "next/server"
import { getWhatsAppProvider } from "@/lib/whatsapp/provider"
import { registerIncoming } from "@/lib/whatsapp/message-service"
import { handleBotMessage } from "@/lib/whatsapp/bot-service"
import { pauseFromWhatsAppOutgoing } from "@/lib/whatsapp/bot-pause"

export const runtime = "nodejs"

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
  // registra os campos-chave do payload cru — sem conteúdo das mensagens —
  // para identificar o formato dos eventos de mensagens enviadas (fromMe).
  if (eventName === "webhookReceived") {
    const p = payload as {
      fromMe?: unknown
      chat?: { id?: string }
      sender?: { id?: string }
      msgContent?: Record<string, unknown>
    }
    console.log(
      `[wa-diag] keys=${Object.keys(p as object).join(",")} fromMe=${JSON.stringify(p.fromMe)} chat=${JSON.stringify(p.chat?.id ?? null)} sender=${JSON.stringify(p.sender?.id ?? null)} msgKeys=${Object.keys(p.msgContent ?? {}).join("|")}`
    )
  }

  if (eventName && eventName !== "webhookReceived") {
    console.log(
      `[WhatsApp Webhook] ${eventName}: ${JSON.stringify(payload).slice(0, 700)}`
    )
  }

  const provider = await getWhatsAppProvider()
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
