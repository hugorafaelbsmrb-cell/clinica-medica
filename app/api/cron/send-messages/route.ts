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
import { queueAutomationMessages } from "@/lib/whatsapp/flow-automations"
import { processAgendamentoFollowUps } from "@/lib/whatsapp/payment-follow-up"
import { queueDueMarketingCampaigns } from "@/lib/marketing/service"
import { sweepExpiredPayments } from "@/lib/payments/router"
import { generateDueFollowUpCharges } from "@/lib/actions/acompanhamentos"
import { getIntegrationSettings } from "@/lib/integrations"
import { getWhatsAppConnection } from "@/lib/whatsapp/connection"
import { claimCronRun, releaseCronRun } from "@/lib/cron-lock"

export const runtime = "nodejs"

const LOCK_NAME = "send-messages"

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

  // Trava simples de concorrência: uma linha por job na tabela CronRun.
  // Evita execuções simultâneas (scheduler duplicado) e repetições rápidas.
  const now = new Date()
  const claimed = await claimCronRun(LOCK_NAME, now)
  if (!claimed) {
    return NextResponse.json({
      ok: false,
      skipped: "Cron já em execução ou executado recentemente",
    })
  }

  try {
    // Sem WhatsApp conectado o ciclo inteiro é suspenso: enfileirar
    // acompanhamentos agora só avançaria marcadores e queimaria a fila.
    const connection = await getWhatsAppConnection()
    if (!connection.connected) {
      return NextResponse.json({
        ok: false,
        skipped: "WhatsApp desconectado — fila e automações preservadas",
        checkedAt: connection.checkedAt,
      })
    }

    const queuedFollowUps = await queueDueFollowUps()
    const queuedReminders = await queueAppointmentReminders()
    const automations = await queueAutomationMessages()
    const marketing = await queueDueMarketingCampaigns()
    const agendamentoFollowUps = await processAgendamentoFollowUps()
    const expiredPayments = await sweepExpiredPayments()
    const followUpCharges = await generateDueFollowUpCharges()
    const { sent, failed } = await processPendingMessages()

    const integrations = await getIntegrationSettings()

    return NextResponse.json({
      ok: true,
      queuedFollowUps,
      queuedReminders,
      automations,
      marketing,
      agendamentoFollowUps,
      expiredPayments,
      followUpCharges,
      sent,
      failed,
      provider:
        integrations.wApiToken && integrations.wApiInstance ? "wapi" : "mock",
    })
  } finally {
    await releaseCronRun(LOCK_NAME)
  }
}
