/**
 * Worker de mensagens WhatsApp.
 *
 * Executa: (1) enfileiramento dos acompanhamentos vencidos e
 * (2) envio da fila de mensagens pendentes.
 *
 * Chamada periódica:
 *  - Local: acessar /api/cron/send-messages?secret=CRON_SECRET
 *  - Produção (Vercel): configurar Cron Job no painel para chamar esta rota
 *    a cada 10 minutos com o header Authorization: Bearer CRON_SECRET
 */
import { NextRequest, NextResponse } from "next/server"
import {
  processPendingMessages,
  queueAppointmentReminders,
  queueDueFollowUps,
} from "@/lib/whatsapp/message-service"
import { queueAutomationMessages } from "@/lib/whatsapp/automations"
import { getIntegrationSettings } from "@/lib/integrations"

export const runtime = "nodejs"

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    // Sem CRON_SECRET configurado, permite apenas em desenvolvimento
    return process.env.NODE_ENV === "development"
  }

  const bearer = request.headers.get("authorization")
  const bearerOk = bearer === `Bearer ${secret}`

  const querySecret = request.nextUrl.searchParams.get("secret")
  return bearerOk || querySecret === secret
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const queuedFollowUps = await queueDueFollowUps()
  const queuedReminders = await queueAppointmentReminders()
  const automations = await queueAutomationMessages()
  const { sent, failed } = await processPendingMessages()

  const integrations = await getIntegrationSettings()

  return NextResponse.json({
    ok: true,
    queuedFollowUps,
    queuedReminders,
    automations,
    sent,
    failed,
    provider:
      integrations.wApiToken && integrations.wApiInstance ? "wapi" : "mock",
  })
}
