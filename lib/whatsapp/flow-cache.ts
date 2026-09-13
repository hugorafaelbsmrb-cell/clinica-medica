/**
 * Cache em memória dos fluxos de WhatsApp (MessageFlow).
 *
 * O bot lê o fluxo BOT a cada mensagem recebida e as automações leem os
 * fluxos AUTOMACAO a cada execução do cron — sem cache, cada leitura
 * transfere os grafos (nodes/edges JSON) do Supabase. TTL de 60s: os
 * fluxos mudam só quando o admin edita (invalidateFlowCache).
 */
import type { MessageFlow } from "@prisma/client"
import { prisma } from "@/lib/prisma"

const CACHE_TTL_MS = 60_000

let botFlowCache: { row: MessageFlow | null; expiresAt: number } | null = null
let automacaoFlowsCache: { rows: MessageFlow[]; expiresAt: number } | null = null

/** Fluxo BOT habilitado (ou null), com cache de 60s. */
export async function getCachedBotFlowRow(): Promise<MessageFlow | null> {
  if (botFlowCache && botFlowCache.expiresAt > Date.now()) {
    return botFlowCache.row
  }

  const row = await prisma.messageFlow.findFirst({
    where: { kind: "BOT", enabled: true },
  })
  botFlowCache = { row, expiresAt: Date.now() + CACHE_TTL_MS }
  return row
}

/** Fluxos AUTOMACAO habilitados, com cache de 60s. */
export async function getCachedAutomacaoFlowRows(): Promise<MessageFlow[]> {
  if (automacaoFlowsCache && automacaoFlowsCache.expiresAt > Date.now()) {
    return automacaoFlowsCache.rows
  }

  const rows = await prisma.messageFlow.findMany({
    where: { kind: "AUTOMACAO", enabled: true },
  })
  automacaoFlowsCache = { rows, expiresAt: Date.now() + CACHE_TTL_MS }
  return rows
}

/** Limpa o cache (chamar após salvar/excluir/ativar/desativar fluxos). */
export function invalidateFlowCache(): void {
  botFlowCache = null
  automacaoFlowsCache = null
}
