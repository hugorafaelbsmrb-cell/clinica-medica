/**
 * Monitor de conexão do WhatsApp.
 *
 * Consulta o estado da instância na W-API, grava em ClinicSettings (o banner
 * do painel lê daí) e dispara push quando o número cai ou volta. Roda a cada
 * 5 minutos — antes disso nada observava a conexão, então uma queda passava
 * semanas em silêncio.
 *
 * Chamada periódica:
 *  - Local: /api/cron/check-connection?secret=CRON_SECRET
 *  - VPS: crontab do container clinica-medica-cron
 */
import { NextRequest, NextResponse } from "next/server"
import { checkAndRecordWhatsAppConnection } from "@/lib/whatsapp/connection"
import { claimCronRun, releaseCronRun } from "@/lib/cron-lock"

export const runtime = "nodejs"

const LOCK_NAME = "check-connection"
/** O ciclo é de 5 min: aceita nova execução após 4 min. */
const MIN_INTERVAL_MS = 4 * 60 * 1000

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return process.env.NODE_ENV === "development"
  }

  const bearer = request.headers.get("authorization")
  const querySecret = request.nextUrl.searchParams.get("secret")
  return bearer === `Bearer ${secret}` || querySecret === secret
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const claimed = await claimCronRun(LOCK_NAME, new Date(), MIN_INTERVAL_MS)
  if (!claimed) {
    return NextResponse.json({
      ok: false,
      skipped: "Verificação já em execução ou executada recentemente",
    })
  }

  try {
    const state = await checkAndRecordWhatsAppConnection()
    if (state.usingWApi && !state.connected) {
      console.warn(
        "[WhatsApp] Instância desconectada — envios automáticos suspensos"
      )
    }
    return NextResponse.json({
      ok: true,
      usingWApi: state.usingWApi,
      connected: state.connected,
      changed: state.changed,
      error: state.error ?? null,
      checkedAt: state.checkedAt,
    })
  } finally {
    await releaseCronRun(LOCK_NAME)
  }
}
