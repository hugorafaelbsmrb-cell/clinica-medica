/**
 * Serviço de campanhas de marketing em massa (WhatsApp).
 *
 * Fluxo:
 *  1. O admin cria/agenda a campanha na tela /marketing (status AGENDADA).
 *  2. O cron (/api/cron/send-messages) chama queueDueMarketingCampaigns():
 *     campanhas AGENDADA vencidas passam a ENVIANDO e o público vira
 *     mensagens na fila (tipo MARKETING) em lotes de 50 por ciclo.
 *  3. processPendingMessages envia cada mensagem (imagem + legenda quando
 *     houver, com fallback para texto) e atualiza sentCount/failedCount.
 *  4. Com o fan-out concluído e a fila zerada, a campanha vira CONCLUIDA.
 */
import { prisma } from "@/lib/prisma"
import { getClinicSettings } from "@/lib/clinic"
import { renderTemplate } from "@/lib/whatsapp/message-service"
import { isValidIndividualPhone } from "@/lib/whatsapp/provider"

/** Lote de fan-out por ciclo do cron (evita picos no WhatsApp). */
export const MARKETING_BATCH_SIZE = 50

export type MarketingAudienceKind = "TODOS" | "MEDICO" | "ATIVOS" | "LEADS"

/**
 * audience (JSON na coluna MarketingCampaign.audience):
 * kind/doctorId/days definem o público; total e fanoutDone são estado
 * interno do envio (contagem inicial e fim do fan-out).
 */
export type MarketingAudience = {
  kind: MarketingAudienceKind
  doctorId?: string | null
  days?: number | null
  total?: number | null
  fanoutDone?: boolean
}

/** Público sempre exige opt-in de WhatsApp, telefone e consentimento LGPD. */
const CONTACTABLE = {
  whatsappEnabled: true,
  phone: { not: null },
  lgpdConsent: true,
} as const

/** Filtro Prisma do público da campanha (fora o opt-in básico). */
function audienceWhere(audience: MarketingAudience, now: Date) {
  const where: Record<string, unknown> = { ...CONTACTABLE }

  if (audience.kind === "MEDICO" && audience.doctorId) {
    // Vínculo paciente ↔ médico (primeira consulta define o responsável).
    where.doctorId = audience.doctorId
  }

  if (audience.kind === "ATIVOS") {
    const days = audience.days ?? 90
    where.attendances = {
      some: {
        status: "REALIZADO",
        scheduledAt: { gte: new Date(now.getTime() - days * 24 * 60 * 60 * 1000) },
      },
    }
  }

  return where
}

/** Normaliza o JSON bruto da coluna audience para o formato tipado. */
export function normalizeAudience(raw: unknown): MarketingAudience {
  const audience = (raw ?? {}) as Partial<MarketingAudience>
  return {
    kind:
      audience.kind === "MEDICO" ||
      audience.kind === "ATIVOS" ||
      audience.kind === "LEADS"
        ? audience.kind
        : "TODOS",
    doctorId: typeof audience.doctorId === "string" ? audience.doctorId : null,
    days: typeof audience.days === "number" ? audience.days : null,
    total: typeof audience.total === "number" ? audience.total : null,
    fanoutDone: audience.fanoutDone === true,
  }
}

/** Conta o público da audiência (prévia na tela e total no disparo). */
export async function countMarketingAudience(
  audience: MarketingAudience,
  now = new Date()
): Promise<number> {
  // Leads: contatos capturados pelo bot que ainda não viraram pacientes.
  if (audience.kind === "LEADS") {
    return prisma.whatsAppContact.count({ where: { converted: false } })
  }

  return prisma.patient.count({
    where: audienceWhere(audience, now) as never,
  })
}

/**
 * Dispara campanhas AGENDADA vencidas: calcula o total do público uma vez,
 * marca ENVIANDO e cria as mensagens em lotes de MARKETING_BATCH_SIZE.
 * Retorna o resumo para a resposta do cron.
 */
export async function queueDueMarketingCampaigns(
  now = new Date()
): Promise<{ started: number; queued: number }> {
  const clinic = await getClinicSettings()
  const due = await prisma.marketingCampaign.findMany({
    where: { status: "AGENDADA", scheduledFor: { lte: now } },
    orderBy: { scheduledFor: "asc" },
    take: 3, // no máximo 3 campanhas iniciam por ciclo
  })

  let queued = 0
  for (const campaign of due) {
    const audience = normalizeAudience(campaign.audience)
    const isLeads = audience.kind === "LEADS"

    // Conta o público uma única vez, no primeiro ciclo da campanha.
    let total = audience.total
    if (total === null) {
      total = await countMarketingAudience(audience, now)
      await prisma.marketingCampaign.update({
        where: { id: campaign.id },
        data: { status: "ENVIANDO", audience: { ...audience, total } },
      })
    }

    let batchSize: number
    if (isLeads) {
      // Leads: contatos capturados pelo bot que ainda não viraram pacientes.
      // A mensagem fica registrada no histórico ligada ao contato (sem paciente).
      const contacts = (
        await prisma.whatsAppContact.findMany({
          where: {
            converted: false,
            messages: { none: { marketingCampaignId: campaign.id } },
          },
          select: { id: true, name: true, phone: true },
          orderBy: { lastMessageAt: "desc" },
          take: MARKETING_BATCH_SIZE * 4,
        })
      )
        // Números de grupos do WhatsApp ficam fora do público.
        .filter((c) => isValidIndividualPhone(c.phone))
        .slice(0, MARKETING_BATCH_SIZE)

      for (const contact of contacts) {
        const firstName = (contact.name ?? "").trim().split(" ")[0]
        let content = renderTemplate(campaign.body, {
          nome: firstName || "cliente",
          clinica: clinic.name,
        })
        if (campaign.linkUrl) {
          content = `${content}\n\n${campaign.linkUrl}`
        }

        await prisma.message.create({
          data: {
            whatsAppContactId: contact.id,
            type: "MARKETING",
            direction: "OUT",
            content,
            status: "PENDENTE",
            scheduledFor: now,
            marketingCampaignId: campaign.id,
          },
        })
      }
      batchSize = contacts.length
    } else {
      // Público restante: quem ainda não recebeu mensagem desta campanha.
      const patients = await prisma.patient.findMany({
        where: {
          ...(audienceWhere(audience, now) as Record<string, unknown>),
          messages: { none: { marketingCampaignId: campaign.id } },
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: MARKETING_BATCH_SIZE,
      })

      for (const patient of patients) {
        let content = renderTemplate(campaign.body, {
          nome: patient.name.split(" ")[0],
          clinica: clinic.name,
        })
        if (campaign.linkUrl) {
          content = `${content}\n\n${campaign.linkUrl}`
        }

        await prisma.message.create({
          data: {
            patientId: patient.id,
            type: "MARKETING",
            direction: "OUT",
            content,
            status: "PENDENTE",
            scheduledFor: now,
            marketingCampaignId: campaign.id,
          },
        })
      }
      batchSize = patients.length
    }

    queued += batchSize

    // Lote menor que o máximo = público esgotado → fan-out concluído.
    const fanoutDone = batchSize < MARKETING_BATCH_SIZE
    await prisma.marketingCampaign.update({
      where: { id: campaign.id },
      data: { audience: { ...audience, total, fanoutDone } },
    })
  }

  return { started: due.length, queued }
}
