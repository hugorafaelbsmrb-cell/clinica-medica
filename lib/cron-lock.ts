/**
 * Trava de concorrência dos jobs do cron (uma linha por job na tabela
 * CronRun). Evita execuções simultâneas — scheduler duplicado, retry do
 * provedor — e repetições rápidas da mesma rotina.
 */
import { prisma } from "@/lib/prisma"

/** Execução sem término por mais de 10 min é assumida como travada (crash). */
const LOCK_IN_PROGRESS_MS = 10 * 60 * 1000
/** Intervalo mínimo entre duas execuções concluídas do mesmo job. */
const LOCK_MIN_INTERVAL_MS = 2 * 60 * 1000

/**
 * Tenta adquirir a trava do job. Retorna false quando outra execução está
 * em andamento (início recente sem término) ou a última terminou há menos
 * de 2 minutos. Linhas travadas por crash são retomadas após 10 minutos.
 */
export async function claimCronRun(
  name: string,
  now = new Date(),
  minIntervalMs = LOCK_MIN_INTERVAL_MS
): Promise<boolean> {
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
  } else if (last.finishedAt.getTime() > now.getTime() - minIntervalMs) {
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

/** Marca o término da execução (liberando a trava para o próximo ciclo). */
export async function releaseCronRun(name: string): Promise<void> {
  await prisma.cronRun
    .updateMany({
      where: { name, finishedAt: null },
      data: { finishedAt: new Date() },
    })
    .catch(() => {})
}
