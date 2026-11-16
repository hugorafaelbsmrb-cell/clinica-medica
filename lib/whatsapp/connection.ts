/**
 * Estado da conexão do WhatsApp (instância da W-API).
 *
 * A W-API aceita POST /message/send-text e responde HTTP 200 com messageId
 * mesmo com a instância desconectada — sem esta guarda, o sistema marcava os
 * envios como ENVIADA e consumia a fila em silêncio (foi o que aconteceu
 * entre 29/out e 15/nov: 18 dias sem ninguém perceber).
 *
 * Aqui ficam:
 *  - a consulta de estado (cache curto, single flight, timeout),
 *  - o registro do estado em ClinicSettings (para o banner e para o cron),
 *  - o aviso por push nas transições (caiu / voltou).
 */
import { prisma } from "@/lib/prisma"
import { getIntegrationSettings } from "@/lib/integrations"
import { invalidateClinicCache } from "@/lib/clinic"
import { dispatchPush } from "@/lib/push"

export type WhatsAppConnectionState = {
  /** false quando não há credenciais da W-API (MockProvider em uso). */
  usingWApi: boolean
  connected: boolean
  checkedAt: Date
  /** Preenchido quando a consulta em si falhou (rede, HTTP, timeout). */
  error?: string
}

/** Janela de reuso da consulta — evita bater na W-API a cada mensagem. */
const CACHE_TTL_MS = 60_000
const CHECK_TIMEOUT_MS = 8_000

type ConnectionCache = {
  state: WhatsAppConnectionState | null
  expiresAt: number
  inFlight: Promise<WhatsAppConnectionState> | null
}

const cacheGlobal = globalThis as unknown as {
  waConnectionCache?: ConnectionCache
}
const cache: ConnectionCache = (cacheGlobal.waConnectionCache ??= {
  state: null,
  expiresAt: 0,
  inFlight: null,
})

/** Descarta o cache — usar quando um evento de conexão chega no webhook. */
export function invalidateWhatsAppConnectionCache(): void {
  cache.state = null
  cache.expiresAt = 0
}

async function fetchConnectionState(): Promise<WhatsAppConnectionState> {
  const checkedAt = new Date()
  const settings = await getIntegrationSettings()

  if (!settings.wApiToken || !settings.wApiInstance) {
    // Sem credenciais o sistema usa o MockProvider: nada a checar.
    return { usingWApi: false, connected: true, checkedAt }
  }

  const url = `https://api.w-api.app/v1/instance/status-instance?instanceId=${encodeURIComponent(
    settings.wApiInstance
  )}`

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${settings.wApiToken}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      cache: "no-store",
    })

    const text = await response.text()
    let data: { connected?: boolean } = {}
    try {
      data = text ? (JSON.parse(text) as { connected?: boolean }) : {}
    } catch {
      data = {}
    }

    if (!response.ok) {
      // Erro do provedor (401/500) não prova que o WhatsApp caiu: segue
      // otimista para não congelar a operação por instabilidade externa.
      return {
        usingWApi: true,
        connected: true,
        checkedAt,
        error: `W-API respondeu ${response.status}`,
      }
    }

    return { usingWApi: true, connected: data.connected === true, checkedAt }
  } catch (error) {
    return {
      usingWApi: true,
      connected: true,
      checkedAt,
      error:
        error instanceof Error
          ? error.message
          : "Falha ao consultar o status da instância",
    }
  }
}

/**
 * Estado atual da conexão. Usa o cache de 60s; `force` consulta o provedor
 * (cron de monitoramento e telas de configuração).
 */
export async function getWhatsAppConnection(
  force = false
): Promise<WhatsAppConnectionState> {
  if (!force && cache.state && cache.expiresAt > Date.now()) {
    return cache.state
  }
  // Single flight: chamadas simultâneas compartilham a mesma consulta.
  if (cache.inFlight) return cache.inFlight

  cache.inFlight = (async () => {
    const state = await fetchConnectionState()
    cache.state = state
    cache.expiresAt = Date.now() + CACHE_TTL_MS
    if (!state.connected) {
      console.warn("[WhatsApp] Instância desconectada — envios bloqueados", {
        checkedAt: state.checkedAt.toISOString(),
      })
    }
    return state
  })()

  try {
    return await cache.inFlight
  } finally {
    cache.inFlight = null
  }
}

/**
 * Grava o estado observado em ClinicSettings e avisa a equipe por push
 * quando o número cai ou volta. Idempotente: só age na transição.
 * Retorna true quando o estado mudou.
 */
export async function applyWhatsAppConnection(
  connected: boolean,
  checkedAt = new Date()
): Promise<boolean> {
  const current = await prisma.clinicSettings.findUnique({
    where: { id: 1 },
    select: { waConnected: true },
  })
  const previous = current?.waConnected ?? null

  if (previous === connected) {
    await prisma.clinicSettings
      .update({ where: { id: 1 }, data: { waStatusCheckedAt: checkedAt } })
      .catch(() => {})
    return false
  }

  await prisma.clinicSettings.update({
    where: { id: 1 },
    data: {
      waConnected: connected,
      waStatusCheckedAt: checkedAt,
      ...(connected
        ? { waConnectedAt: checkedAt }
        : { waDisconnectedAt: checkedAt }),
    },
  })

  // Primeira observação (sem histórico) não é transição — só registra.
  if (previous === null) return false

  // O layout do painel lê o estado pelo cache da clínica (60s): limpa para
  // o banner aparecer/sumir na hora.
  invalidateClinicCache()

  if (connected) {
    await dispatchPush({
      title: "WhatsApp reconectado",
      body: "O número da clínica voltou: os envios automáticos foram retomados.",
      url: "/configuracoes",
    })
  } else {
    await dispatchPush({
      title: "WhatsApp desconectado",
      body: "O número da clínica caiu. Os envios automáticos estão pausados — reconecte em Configurações → Integrações.",
      url: "/configuracoes",
    })
  }

  console.log(
    `[WhatsApp] Estado da conexão alterado: ${previous} -> ${connected}`
  )
  return true
}

/**
 * Consulta o estado e persiste o resultado. Só grava quando a consulta foi
 * conclusiva (sem erro de rede/HTTP) para não registrar falso positivo.
 */
export async function checkAndRecordWhatsAppConnection(): Promise<
  WhatsAppConnectionState & { changed: boolean }
> {
  const state = await getWhatsAppConnection(true)
  if (!state.usingWApi || state.error) {
    return { ...state, changed: false }
  }
  const changed = await applyWhatsAppConnection(state.connected, state.checkedAt)
  return { ...state, changed }
}
