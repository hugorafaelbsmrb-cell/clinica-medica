/**
 * Pausa do bot por conversa (atendimento humano).
 *
 * Enquanto uma linha de BotPause existe e o resumeAt não venceu, nenhuma
 * mensagem automática sai para aquele número — só o que a equipe escreve
 * manualmente. Gatilhos de pausa:
 *  - a equipe envia mensagem manual pelo painel (atendimento_humano);
 *  - a equipe responde pelo próprio WhatsApp (atendimento_humano);
 *  - o paciente pede "atendente" (pediu_atendente).
 * A retomada é automática quando resumeAt passa; cada mensagem manual da
 * equipe renova o prazo (botPauseHours em Configurações → Automações).
 */
import { prisma } from "@/lib/prisma"
import { getClinicSettings } from "@/lib/clinic"
import { normalizePhone } from "./provider"

export type BotPauseReason = "atendimento_humano" | "pediu_atendente"

const HOUR_MS = 60 * 60 * 1000

/** Horas de silêncio configuradas no painel (padrão 24h). */
async function getPauseHours(): Promise<number> {
  const clinic = await getClinicSettings()
  const hours = Number(clinic.botPauseHours)
  return Number.isFinite(hours) && hours > 0 ? hours : 24
}

/** Pausa (ou renova) o bot para o número até now + botPauseHours. */
export async function pauseBotForPhone(
  phone: string,
  reason: BotPauseReason
): Promise<void> {
  const normalized = normalizePhone(phone)
  if (!normalized) return

  const hours = await getPauseHours()
  const resumeAt = new Date(Date.now() + hours * HOUR_MS)
  await prisma.botPause.upsert({
    where: { phone: normalized },
    update: { reason, resumeAt },
    create: { phone: normalized, reason, resumeAt },
  })
}

/**
 * Estende o prazo de uma pausa ativa (nova mensagem manual da equipe).
 * Não faz nada quando o número não está pausado ou a pausa já venceu.
 */
export async function refreshBotPause(phone: string): Promise<void> {
  const normalized = normalizePhone(phone)
  if (!normalized) return

  const pause = await prisma.botPause.findUnique({ where: { phone: normalized } })
  if (!pause || pause.resumeAt.getTime() <= Date.now()) return

  const hours = await getPauseHours()
  await prisma.botPause.update({
    where: { phone: normalized },
    data: { resumeAt: new Date(Date.now() + hours * HOUR_MS) },
  })
}

/** True quando o número está com o bot pausado (apaga linha vencida). */
export async function isPhonePaused(phone: string): Promise<boolean> {
  const normalized = normalizePhone(phone)
  if (!normalized) return false

  const pause = await prisma.botPause.findUnique({ where: { phone: normalized } })
  if (!pause) return false
  if (pause.resumeAt.getTime() <= Date.now()) {
    await prisma.botPause.delete({ where: { phone: normalized } }).catch(() => {})
    return false
  }
  return true
}

/** Apaga pausas vencidas. Retorna quantas foram removidas. */
export async function sweepExpiredBotPauses(now = new Date()): Promise<number> {
  const result = await prisma.botPause.deleteMany({
    where: { resumeAt: { lte: now } },
  })
  return result.count
}

export type ActiveBotPause = {
  phone: string
  reason: BotPauseReason
  resumeAt: Date
  patientName: string | null
}

/**
 * Lista as pausas ativas para o painel, com o nome do paciente quando o
 * número pertence a um cadastro (mesma busca por dígitos finais usada no
 * registro de mensagens recebidas).
 */
export async function listActiveBotPauses(
  now = new Date()
): Promise<ActiveBotPause[]> {
  const pauses = await prisma.botPause.findMany({
    where: { resumeAt: { gt: now } },
    orderBy: { resumeAt: "asc" },
  })

  const result: ActiveBotPause[] = []
  for (const pause of pauses) {
    const lastDigits = pause.phone.slice(-9)
    const candidates = await prisma.patient.findMany({
      where: { phone: { endsWith: lastDigits } },
      select: { name: true, phone: true },
    })
    const patient = candidates.find(
      (candidate) =>
        candidate.phone && normalizePhone(candidate.phone) === pause.phone
    )
    result.push({
      phone: pause.phone,
      reason: pause.reason as BotPauseReason,
      resumeAt: pause.resumeAt,
      patientName: patient?.name ?? null,
    })
  }
  return result
}

/**
 * Detecta uma mensagem que a equipe enviou pelo próprio WhatsApp (fora do
 * painel) e pausa o bot para aquela conversa. A W-API também dispara o
 * webhook para envios feitos pela API (fromMe = true), então o evento só
 * pausa quando não bate com um envio recente nosso (filtro de eco).
 * Retorna true quando a conversa foi pausada ou renovada.
 */
export async function pauseFromWhatsAppOutgoing(
  phone: string,
  content: string,
  sentAt: Date
): Promise<boolean> {
  const normalized = normalizePhone(phone)
  if (!normalized) return false

  const lastDigits = normalized.slice(-9)
  const candidates = await prisma.patient.findMany({
    where: { phone: { endsWith: lastDigits } },
    select: { id: true, phone: true },
  })
  const patientIds = candidates
    .filter(
      (candidate) =>
        candidate.phone && normalizePhone(candidate.phone) === normalized
    )
    .map((candidate) => candidate.id)

  // Eco do bot: houve envio nosso para esse número nos últimos minutos?
  const windowStart = new Date(sentAt.getTime() - 2 * 60 * 1000)
  const windowEnd = new Date(sentAt.getTime() + 3 * 60 * 1000)
  if (patientIds.length > 0) {
    const recent = await prisma.message.findFirst({
      where: {
        patientId: { in: patientIds },
        direction: "OUT",
        sentAt: { gte: windowStart, lte: windowEnd },
        ...(content.trim() ? { content: content.trim() } : {}),
      },
      orderBy: { sentAt: "desc" },
    })
    if (recent) {
      console.log(`[bot-pause] eco de envio da API ignorado (${normalized})`)
      return false
    }
  }

  await pauseBotForPhone(normalized, "atendimento_humano")
  console.log(`[bot-pause] pausado via WhatsApp (${normalized})`)
  return true
}
