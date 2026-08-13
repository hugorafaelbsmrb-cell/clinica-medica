/**
 * Webhook do WhatsApp: recebe respostas dos pacientes e registra no prontuário.
 * URL para configurar no painel da W-API: /api/webhooks/whatsapp
 */
import { NextRequest, NextResponse } from "next/server"
import { getWhatsAppProvider } from "@/lib/whatsapp/provider"
import { registerIncoming } from "@/lib/whatsapp/message-service"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 })
  }

  const provider = await getWhatsAppProvider()
  const messages = await provider.parseWebhook(payload)

  for (const message of messages) {
    await registerIncoming(message.from, message.content, message.receivedAt)
  }

  return NextResponse.json({ ok: true, received: messages.length })
}
