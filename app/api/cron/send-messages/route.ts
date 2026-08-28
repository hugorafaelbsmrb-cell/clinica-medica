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
import { prisma } from "@/lib/prisma"
import {
  processPendingMessages,
  queueAppointmentReminders,
  queueDueFollowUps,
} from "@/lib/whatsapp/message-service"
import { queueAutomationMessages } from "@/lib/whatsapp/automations"
import { processAgendamentoFollowUps } from "@/lib/whatsapp/payment-follow-up"
import { queueDueMarketingCampaigns } from "@/lib/marketing/service"
import { sweepExpiredPayments } from "@/lib/payments/router"
import { generateDueFollowUpCharges } from "@/lib/actions/acompanhamentos"
import { getIntegrationSettings } from "@/lib/integrations"

export const runtime = "nodejs"

const LOCK_NAME = "send-messages"
/** Execução sem término por mais de 10 min é assumida como travada (crash). */
const LOCK_IN_PROGRESS_MS = 10 * 60 * 1000
/** Pula execuções com menos de 5 min desde a última concluída. */
const LOCK_MIN_INTERVAL_MS = 5 * 60 * 1000

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
    await prisma.cronRun.updateMany({
      where: { name: LOCK_NAME, finishedAt: null },
      data: { finishedAt: new Date() },
    })
  }
}

/**
 * Tenta adquirir a trava do job. Retorna false quando outra execução está
 * em andamento (início recente sem término) ou a última terminou há menos
 * de 5 minutos. Linhas travadas por crash são retomadas após 10 minutos.
 */
async function claimCronRun(name: string, now: Date): Promise<boolean> {
  const last = await prisma.cronRun.findUnique({ where: { name } })
  if (!last) {
    try {
      await prisma.cronRun.create({ data: { name, startedAt: now } })
      return true
    } catch {
      // P2002: outra instância criou a linha agora mesmo.
      return false
    }
  }

  if (!last.finishedAt) {
    if (last.startedAt.getTime() > now.getTime() - LOCK_IN_PROGRESS_MS) {
      return false // execução em andamento
    }
  } else if (last.finishedAt.getTime() > now.getTime() - LOCK_MIN_INTERVAL_MS) {
    return false // executado recentemente
  }

  // Retoma a trava para esta execução. O compare-and-swap (filtro pelo
  // estado lido) impede duas instâncias de tomarem posse ao mesmo tempo.
  const claimed = await prisma.cronRun.updateMany({
    where: {
      name,
      id: last.id,
      startedAt: last.startedAt,
      finishedAt: last.finishedAt,
    },
    data: { startedAt: now, finishedAt: null },
  })
  return claimed.count > 0
}
