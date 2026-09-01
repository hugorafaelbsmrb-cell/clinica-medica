/**
 * MessageService: fila de envio, templates e agendamento de acompanhamento.
 *
 * Fluxo:
 *  1. Mensagens são enfileiradas na tabela Message com status PENDENTE.
 *  2. O worker (app/api/cron/send-messages) chama processPendingMessages()
 *     e envia tudo que está PENDENTE e com scheduledFor vencido.
 *  3. queueFollowUps() verifica FollowUpConfig e enfileira novas mensagens
 *     de acompanhamento para pacientes que venceram a periodicidade.
 */
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { prisma } from "@/lib/prisma"
import { getClinicSettings } from "@/lib/clinic"
import {
  getWhatsAppProvider,
  normalizePhone,
  type SendResult,
  type WhatsAppButton,
  type WhatsAppProvider,
} from "./provider"
import { isPhonePaused, pauseBotForPhone, refreshBotPause } from "./bot-pause"

/** Substitui variáveis {{nome}}, {{data}} no corpo do template. */
export function renderTemplate(
  body: string,
  variables: Record<string, string>
): string {
  return Object.entries(variables).reduce(
    (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value),
    body
  )
}

/** Frase do Meet para teleconsultas (vazia quando não há link). */
function meetSentenceFor(meetLink: string | null): string {
  return meetLink
    ? `Sua teleconsulta será por videochamada: ${meetLink}`
    : ""
}

/**
 * Remove a frase do Meet do conteúdo quando não há link cadastrado
 * (o template padrão traz "Sua teleconsulta será por videochamada: {{meet}}")
 * — assim o texto atual é mantido para consultas sem link.
 */
function withoutMeetSentence(content: string): string {
  return content.replace(/Sua teleconsulta será por videochamada:\s*/, "")
}

/** Expressão para links http(s) no corpo da mensagem. */
const LINK_PATTERN = /https?:\/\/[^\s]+/g

/**
 * Extrai até `limit` links http(s) do texto, sem pontuação colada no fim.
 * Links duplicados aparecem uma vez só.
 */
export function extractLinks(content: string, limit = 3): string[] {
  const matches = content.match(LINK_PATTERN) ?? []
  return [...new Set(matches)]
    .map((m) => m.replace(/[),.;!?]+$/, ""))
    .slice(0, limit)
}

/**
 * Envia texto com botão(ões) de URL quando há link no conteúdo e o provedor
 * suporta (W-API send-buttons-action). Se o envio com botão falhar — ex.:
 * plano sem suporte a botões — reenvia o texto puro para nunca perder a
 * entrega.
 */
export async function sendTextSmart(
  provider: WhatsAppProvider,
  phone: string,
  content: string,
  buttons?: WhatsAppButton[],
  defaultLabel = "Abrir link"
): Promise<SendResult> {
  const resolved =
    buttons?.length
      ? buttons
      : extractLinks(content).map((url) => ({
          type: "URL" as const,
          label: defaultLabel,
          url,
        }))

  if (resolved.length && provider.sendTextWithButtons) {
    const result = await provider.sendTextWithButtons(phone, content, resolved)
    if (result.ok) return result
    console.warn(
      `[WhatsApp] Botões falharam (${result.error}) — reenviando como texto puro`
    )
  }

  return provider.sendText(phone, content)
}

/**
 * Baixa uma imagem do storage e a converte em data URL (base64) para o
 * envio nativo do WhatsApp (send-image). Retorna null em falha — o chamador
 * cai para o texto da legenda.
 */
async function downloadImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const contentType = response.headers.get("content-type") ?? "image/jpeg"
    if (!contentType.startsWith("image/")) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    return `data:${contentType};base64,${buffer.toString("base64")}`
  } catch (error) {
    console.warn(`[WhatsApp] Falha ao baixar imagem (${url}):`, error)
    return null
  }
}

export async function enqueueMessage(
  patientId: string,
  type:
    | "PRIMEIRO_CONTATO"
    | "ACOMPANHAMENTO"
    | "MANUAL"
    | "DOCUMENTO"
    | "CONFIRMACAO_AGENDAMENTO"
    | "LEMBRETE_CONSULTA"
    | "TRATAMENTO_PERIODICO"
    | "ANIVERSARIO"
    | "REATIVACAO"
    | "AGRADECIMENTO"
    | "MEDICO_A_CAMINHO"
    | "LINK_PAGAMENTO"
    | "LEMBRETE_PAGAMENTO"
    | "PAGAMENTO_CONFIRMADO"
    | "AGENDAMENTO_CANCELADO",
  content: string,
  scheduledFor?: Date,
  attendanceId?: string
) {
  // Conversa em atendimento humano: mensagem automatizada não sai. Os
  // fluxos que controlam estágios (lembretes, follow-ups) conferem o
  // retorno null para não avançar o marcador sem enviar.
  if (type !== "MANUAL" && type !== "DOCUMENTO") {
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { phone: true },
    })
    if (patient?.phone && (await isPhonePaused(patient.phone))) return null
  }

  return prisma.message.create({
    data: {
      patientId,
      attendanceId: attendanceId ?? null,
      type,
      direction: "OUT",
      content,
      status: "PENDENTE",
      scheduledFor: scheduledFor ?? new Date(),
    },
  })
}

/**
 * Envio imediato (sem passar pelo cron): usado quando a mensagem não pode
 * esperar, como o aviso "médico a caminho" e as mensagens do fluxo de
 * pagamento (link de pagamento, confirmação da consulta e aviso de pagamento
 * recebido). Registra na tabela Message o resultado (ENVIADA/FALHA) para
 * histórico no painel WhatsApp.
 */
export async function sendImmediateMessage(
  patientId: string,
  type:
    | "MEDICO_A_CAMINHO"
    | "MANUAL"
    | "LINK_PAGAMENTO"
    | "CONFIRMACAO_AGENDAMENTO"
    | "PAGAMENTO_CONFIRMADO",
  content: string,
  attendanceId?: string,
  /** Botões explícitos (ex.: "Pagar agora" → link de pagamento). Sem eles,
   *  os links do texto viram botões "Abrir link" automaticamente. */
  buttons?: WhatsAppButton[]
): Promise<{ ok: boolean; error?: string }> {
  const patient = await prisma.patient.findUnique({ where: { id: patientId } })
  if (!patient?.phone) {
    return { ok: false, error: "Paciente sem telefone" }
  }

  // Pausa do bot (atendimento humano): só mensagens da equipe saem.
  // Cada MANUAL enviada renova o prazo de silêncio do bot.
  if (type !== "MANUAL") {
    if (await isPhonePaused(patient.phone)) {
      return { ok: false, error: "Bot pausado — atendimento humano" }
    }
  } else {
    await refreshBotPause(patient.phone)
  }

  const provider = await getWhatsAppProvider()
  const result = await sendTextSmart(
    provider,
    normalizePhone(patient.phone),
    content,
    buttons,
    type === "LINK_PAGAMENTO" ? "Pagar agora" : "Abrir link"
  )

  await prisma.message.create({
    data: {
      patientId,
      attendanceId: attendanceId ?? null,
      type,
      direction: "OUT",
      content,
      status: result.ok ? "ENVIADA" : "FALHA",
      scheduledFor: new Date(),
      sentAt: result.ok ? new Date() : null,
      error: result.ok ? null : (result.error ?? "Erro desconhecido"),
    },
  })

  return result.ok
    ? { ok: true }
    : { ok: false, error: result.error ?? "Erro desconhecido" }
}

/**
 * Primeiro contato: chamado ao cadastrar um paciente com WhatsApp habilitado.
 * Usa o template "Primeiro contato" se existir, senão um texto padrão.
 */
export async function queueFirstContact(patientId: string): Promise<void> {
  const patient = await prisma.patient.findUnique({ where: { id: patientId } })
  if (!patient?.phone || !patient.whatsappEnabled) return

  const clinic = await getClinicSettings()
  const template = await prisma.messageTemplate.findFirst({
    where: { type: "PRIMEIRO_CONTATO", active: true },
  })

  const content = template
    ? renderTemplate(template.body, {
        nome: patient.name.split(" ")[0],
        data: format(new Date(), "dd/MM/yyyy", { locale: ptBR }),
        clinica: clinic.name,
      })
    : `Olá ${patient.name.split(" ")[0]}! Aqui é da ${clinic.name}. Que bom ter você com a gente!`

  await enqueueMessage(patientId, "PRIMEIRO_CONTATO", content)
}

/**
 * Envia mensagem manual para um paciente (texto livre).
 * Exige consentimento LGPD e telefone cadastrado.
 */
export async function sendManualMessage(
  patientId: string,
  content: string
): Promise<{ ok: boolean; message: string }> {
  const patient = await prisma.patient.findUnique({ where: { id: patientId } })
  if (!patient) return { ok: false, message: "Paciente não encontrado" }
  if (!patient.lgpdConsent) {
    return {
      ok: false,
      message: "Paciente sem consentimento LGPD para contato",
    }
  }
  if (!patient.phone) {
    return { ok: false, message: "Paciente sem telefone cadastrado" }
  }

  await enqueueMessage(patientId, "MANUAL", content)

  // A equipe assumiu a conversa: pausa o bot para este número e limpa o
  // destaque "Pediu atendente" das mensagens anteriores.
  await pauseBotForPhone(patient.phone, "atendimento_humano")
  await prisma.message.updateMany({
    where: { patientId, needsAttention: true },
    data: { needsAttention: false },
  })

  return { ok: true, message: "Mensagem enfileirada para envio" }
}

/**
 * Enfileira todos os passos de uma jornada de mensagens para o paciente,
 * com scheduledFor = agora + soma acumulada dos atrasos (o do 1º passo é
 * relativo ao início). Passos de mídia carregam mediaUrl/mediaType; o
 * conteúdo do passo vira a legenda.
 *
 * Retorna null quando o bot está pausado para o número (atendimento
 * humano) — nesse caso nenhum passo é criado.
 */
export async function enqueueJourneyForPatient(
  patientId: string,
  journeyId: string
): Promise<number | null> {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { phone: true },
  })
  if (!patient?.phone) return null
  if (await isPhonePaused(patient.phone)) return null

  const journey = await prisma.messageJourney.findUnique({
    where: { id: journeyId },
    include: { steps: { orderBy: { position: "asc" } } },
  })
  if (!journey || !journey.active || journey.steps.length === 0) return null

  const now = new Date()
  let cumulativeHours = 0
  const rows = journey.steps.map((step) => {
    cumulativeHours += step.delayHours
    const isMedia = step.kind !== "TEXTO"
    return {
      patientId,
      type: "JORNADA" as const,
      direction: "OUT" as const,
      content: step.content,
      status: "PENDENTE" as const,
      scheduledFor: new Date(
        now.getTime() + cumulativeHours * 60 * 60 * 1000
      ),
      mediaUrl: isMedia ? step.mediaUrl : null,
      mediaType: isMedia ? (step.kind === "IMAGEM" ? "IMAGEM" : "VIDEO") : null,
    }
  })

  await prisma.message.createMany({ data: rows })
  return rows.length
}

/**
 * Envia um documento PDF imediatamente (sem fila) e registra no histórico.
 * Exige consentimento LGPD e telefone cadastrado.
 */
export async function sendDocumentMessage(
  patientId: string,
  caption: string,
  document: Buffer,
  fileName: string
): Promise<{ ok: boolean; message: string }> {
  const patient = await prisma.patient.findUnique({ where: { id: patientId } })
  if (!patient) return { ok: false, message: "Paciente não encontrado" }
  if (!patient.whatsappEnabled) {
    return { ok: false, message: "Paciente sem WhatsApp habilitado" }
  }
  if (!patient.lgpdConsent) {
    return {
      ok: false,
      message: "Paciente sem consentimento LGPD para contato",
    }
  }
  if (!patient.phone) {
    return { ok: false, message: "Paciente sem telefone cadastrado" }
  }

  const provider = await getWhatsAppProvider()
  const result = await provider.sendDocument(
    normalizePhone(patient.phone),
    caption,
    document,
    fileName
  )

  // Envio da equipe também assume a conversa: renova a pausa do bot.
  await refreshBotPause(patient.phone)

  await prisma.message.create({
    data: {
      patientId,
      type: "DOCUMENTO",
      direction: "OUT",
      content: `${caption} (${fileName})`,
      status: result.ok ? "ENVIADA" : "FALHA",
      sentAt: result.ok ? new Date() : null,
      error: result.ok ? null : result.error ?? "Erro desconhecido",
    },
  })

  return result.ok
    ? { ok: true, message: "PDF enviado por WhatsApp" }
    : { ok: false, message: result.error ?? "Falha ao enviar o PDF" }
}

/**
 * Worker de acompanhamento: para cada FollowUpConfig ativo com nextDueAt vencido,
 * enfileira a mensagem de acompanhamento e atualiza a próxima data.
 */
export async function queueDueFollowUps(now = new Date()): Promise<number> {
  const due = await prisma.followUpConfig.findMany({
    where: {
      active: true,
      nextDueAt: { lte: now },
      patient: {
        whatsappEnabled: true,
        phone: { not: null },
        lgpdConsent: true,
      },
    },
    include: { patient: true },
  })

  const template = await prisma.messageTemplate.findFirst({
    where: { type: "ACOMPANHAMENTO", active: true },
  })

  const clinic = await getClinicSettings()
  let queued = 0
  for (const config of due) {
    const content = template
      ? renderTemplate(template.body, {
          nome: config.patient.name.split(" ")[0],
          data: format(now, "dd/MM/yyyy", { locale: ptBR }),
          clinica: clinic.name,
        })
      : `Olá ${config.patient.name.split(" ")[0]}, tudo bem? Como está a sua saúde?`

    // Bot pausado: enqueueMessage retorna null e o ciclo não avança — o
    // acompanhamento reaparece no próximo cron, quando o bot voltar.
    const created = await enqueueMessage(
      config.patientId,
      "ACOMPANHAMENTO",
      content,
      now
    )
    if (!created) continue

    await prisma.followUpConfig.update({
      where: { id: config.id },
      data: {
        lastSentAt: now,
        nextDueAt: new Date(
          now.getTime() + config.intervalDays * 24 * 60 * 60 * 1000
        ),
      },
    })
    queued++
  }

  return queued
}

/**
 * Confirmação de agendamento: envia imediatamente a mensagem com os dados
 * da consulta e o link público para remarcação.
 */
export async function queueAppointmentConfirmation(
  patientId: string,
  attendance: { id: string; scheduledAt: Date; cancelToken: string | null }
): Promise<void> {
  const patient = await prisma.patient.findUnique({ where: { id: patientId } })
  if (!patient?.phone || !patient.whatsappEnabled || !patient.lgpdConsent) return

  const template = await prisma.messageTemplate.findFirst({
    where: { type: "CONFIRMACAO_AGENDAMENTO", active: true },
  })

  // Link do Meet: somente teleconsulta com link padrão cadastrado pelo médico.
  const stored = await prisma.attendance.findUnique({
    where: { id: attendance.id },
    select: { type: true, doctor: { select: { meetLink: true } } },
  })
  const meetLink =
    stored?.type === "TELECONSULTA" ? (stored.doctor?.meetLink ?? null) : null

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  const manageLink = `${baseUrl}/cancelar/${attendance.cancelToken ?? ""}`

  const meetSentence = meetSentenceFor(meetLink)

  const clinic = await getClinicSettings()
  const content = template
    ? withoutMeetSentence(
        renderTemplate(template.body, {
          nome: patient.name.split(" ")[0],
          data: format(attendance.scheduledAt, "dd/MM/yyyy", { locale: ptBR }),
          hora: format(attendance.scheduledAt, "HH:mm", { locale: ptBR }),
          link: manageLink,
          meet: meetLink ?? "",
          clinica: clinic.name,
        })
      )
    : `Olá ${patient.name.split(" ")[0]}! Sua consulta está confirmada para ${format(
        attendance.scheduledAt,
        "dd/MM/yyyy",
        { locale: ptBR }
      )} às ${format(attendance.scheduledAt, "HH:mm", { locale: ptBR })}. Se precisar remarcar, acesse: ${manageLink}${meetSentence ? `\n${meetSentence}` : ""}`

  await sendImmediateMessage(
    patientId,
    "CONFIRMACAO_AGENDAMENTO",
    content,
    attendance.id,
    [
      { type: "URL", label: "Remarcar consulta", url: manageLink },
      ...(meetLink
        ? [{ type: "URL" as const, label: "Entrar na videochamada", url: meetLink }]
        : []),
    ]
  )
}

/**
 * Lembrete de consulta: enfileira LEMBRETE_CONSULTA para atendimentos
 * AGENDADO que acontecem em até 25h e ainda não receberam lembrete.
 * Chamado pelo cron junto com os acompanhamentos.
 */
export async function queueAppointmentReminders(now = new Date()): Promise<number> {
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000)

  const attendances = await prisma.attendance.findMany({
    where: {
      status: "AGENDADO",
      scheduledAt: { gte: now, lte: windowEnd },
      patient: {
        whatsappEnabled: true,
        phone: { not: null },
        lgpdConsent: true,
      },
    },
    include: { patient: true, doctor: { select: { meetLink: true } } },
  })

  const template = await prisma.messageTemplate.findFirst({
    where: { type: "LEMBRETE_CONSULTA", active: true },
  })

  const clinic = await getClinicSettings()
  let queued = 0
  for (const attendance of attendances) {
    // Evita duplicar lembrete para a mesma consulta
    const existing = await prisma.message.findFirst({
      where: { type: "LEMBRETE_CONSULTA", attendanceId: attendance.id },
    })
    if (existing) continue

    // Data relativa: "hoje", "amanhã" ou dia dd/MM para os próximos dias.
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const whenLabel =
      attendance.scheduledAt.toDateString() === now.toDateString()
        ? "hoje"
        : attendance.scheduledAt.toDateString() === tomorrow.toDateString()
          ? "amanhã"
          : `no dia ${format(attendance.scheduledAt, "dd/MM", { locale: ptBR })}`

    // Link do Meet: somente teleconsulta com link padrão cadastrado pelo médico.
    const meetLink =
      attendance.type === "TELECONSULTA"
        ? (attendance.doctor?.meetLink ?? null)
        : null
    const meetSentence = meetSentenceFor(meetLink)

    const content = template
      ? withoutMeetSentence(
          renderTemplate(template.body, {
            nome: attendance.patient.name.split(" ")[0],
            data: format(attendance.scheduledAt, "dd/MM/yyyy", { locale: ptBR }),
            hora: format(attendance.scheduledAt, "HH:mm", { locale: ptBR }),
            meet: meetLink ?? "",
            clinica: clinic.name,
          })
        )
      : `Olá ${attendance.patient.name.split(" ")[0]}! Lembrete: sua consulta é ${whenLabel}, ${format(
          attendance.scheduledAt,
          "dd/MM/yyyy",
          { locale: ptBR }
        )} às ${format(attendance.scheduledAt, "HH:mm", { locale: ptBR })}.${meetSentence ? `\n${meetSentence}` : ""}`

    await enqueueMessage(
      attendance.patientId,
      "LEMBRETE_CONSULTA",
      content,
      now,
      attendance.id
    )
    queued++
  }

  return queued
}

/**
 * Marca a campanha como CONCLUIDA quando o fan-out terminou e não há
 * mais mensagens pendentes dela na fila.
 */
async function maybeCompleteMarketingCampaign(campaignId: string): Promise<void> {
  const [campaign, pendingCount] = await Promise.all([
    prisma.marketingCampaign.findUnique({
      where: { id: campaignId },
      select: { status: true, audience: true },
    }),
    prisma.message.count({
      where: { marketingCampaignId: campaignId, status: "PENDENTE" },
    }),
  ])

  if (
    !campaign ||
    campaign.status === "CONCLUIDA" ||
    campaign.status === "CANCELADA"
  ) {
    return
  }

  const audience = (campaign.audience ?? {}) as { fanoutDone?: boolean }
  if (!audience.fanoutDone || pendingCount > 0) return

  await prisma.marketingCampaign.update({
    where: { id: campaignId },
    data: { status: "CONCLUIDA" },
  })
}

/**
 * Processa a fila: envia todas as mensagens PENDENTE cujo scheduledFor já venceu.
 * Retorna o resumo de sucessos/falhas.
 */
export async function processPendingMessages(
  now = new Date()
): Promise<{ sent: number; failed: number }> {
  const provider = await getWhatsAppProvider()

  const pending = await prisma.message.findMany({
    where: {
      status: "PENDENTE",
      scheduledFor: { lte: now },
      direction: "OUT",
    },
    include: { patient: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  })

  // Campanhas de marketing envolvidas no lote (uma consulta só).
  const campaignIds = [
    ...new Set(
      pending
        .filter((m) => m.type === "MARKETING" && m.marketingCampaignId)
        .map((m) => m.marketingCampaignId!)
    ),
  ]
  const campaigns = campaignIds.length
    ? await prisma.marketingCampaign.findMany({
        where: { id: { in: campaignIds } },
      })
    : []
  const campaignById = new Map(campaigns.map((c) => [c.id, c]))

  let sent = 0
  let failed = 0
  const touchedCampaigns = new Set<string>()

  // Números com o bot pausado (atendimento humano): mensagens
  // automatizadas da fila viram SUPRIMIDA — só MANUAL/DOCUMENTO saem.
  const phones = pending
    .map((m) => normalizePhone(m.patient.phone ?? ""))
    .filter(Boolean)
  const pausedRows = phones.length
    ? await prisma.botPause.findMany({
        where: { phone: { in: phones }, resumeAt: { gt: now } },
        select: { phone: true },
      })
    : []
  const pausedPhones = new Set(pausedRows.map((p) => p.phone))

  for (const message of pending) {
    const phone = normalizePhone(message.patient.phone ?? "")
    const campaign = message.marketingCampaignId
      ? campaignById.get(message.marketingCampaignId)
      : null

    if (!message.patient.phone) {
      await prisma.message.update({
        where: { id: message.id },
        data: { status: "FALHA", error: "Paciente sem telefone" },
      })
      failed++
      if (campaign) {
        await prisma.marketingCampaign.update({
          where: { id: campaign.id },
          data: { failedCount: { increment: 1 } },
        })
        touchedCampaigns.add(campaign.id)
      }
      continue
    }

    // Conversa em atendimento humano: mensagem automatizada não sai
    // (fica registrada como SUPRIMIDA para auditoria). Mensagens da
    // equipe (MANUAL/DOCUMENTO) passam sempre.
    if (
      pausedPhones.has(phone) &&
      message.type !== "MANUAL" &&
      message.type !== "DOCUMENTO"
    ) {
      await prisma.message.update({
        where: { id: message.id },
        data: {
          status: "SUPRIMIDA",
          error: "Bot pausado — atendimento humano",
        },
      })
      continue
    }

    // Campanha cancelada depois do fan-out: não envia.
    if (campaign && campaign.status === "CANCELADA") {
      await prisma.message.update({
        where: { id: message.id },
        data: { status: "FALHA", error: "Campanha cancelada" },
      })
      failed++
      continue
    }

    // Marketing com imagem: tenta enviar a mídia com a legenda; quando o
    // provedor não suporta ou falha, cai para texto puro (com o link).
    // Passos de mídia da jornada (mediaType IMAGEM/VIDEO) seguem o mesmo
    // princípio: tenta a mídia e cai para o texto da legenda.
    // Mensagens com link ganham botão URL; se o botão falhar, o envio cai
    // automaticamente para texto puro (sem perder a entrega).
    let result: SendResult | undefined
    if (campaign?.imageDataUrl && provider.sendImage) {
      result = await provider.sendImage(phone, message.content, campaign.imageDataUrl)
    }
    if (!result?.ok && message.mediaType && message.mediaUrl) {
      if (message.mediaType === "VIDEO" && provider.sendVideo) {
        result = await provider.sendVideo(
          phone,
          message.mediaUrl,
          message.content
        )
      } else if (message.mediaType === "IMAGEM" && provider.sendImage) {
        const dataUrl = await downloadImageAsDataUrl(message.mediaUrl)
        if (dataUrl) {
          result = await provider.sendImage(phone, message.content, dataUrl)
        }
      }
    }
    if (!result?.ok) {
      result = await sendTextSmart(
        provider,
        phone,
        message.content,
        undefined,
        message.type === "LINK_PAGAMENTO" || message.type === "LEMBRETE_PAGAMENTO"
          ? "Pagar agora"
          : message.content.includes("/cadastro")
            ? "Fazer agendamento"
            : "Abrir link"
      )
    }

    if (result.ok) {
      await prisma.message.update({
        where: { id: message.id },
        data: { status: "ENVIADA", sentAt: now, error: null },
      })
      if (campaign) {
        await prisma.marketingCampaign.update({
          where: { id: campaign.id },
          data: { sentCount: { increment: 1 } },
        })
        touchedCampaigns.add(campaign.id)
      }
      sent++
    } else {
      await prisma.message.update({
        where: { id: message.id },
        data: { status: "FALHA", error: result.error ?? "Erro desconhecido" },
      })
      if (campaign) {
        await prisma.marketingCampaign.update({
          where: { id: campaign.id },
          data: { failedCount: { increment: 1 } },
        })
        touchedCampaigns.add(campaign.id)
      }
      failed++
    }
  }

  // Fila da campanha zerada + fan-out concluído → campanha CONCLUIDA.
  for (const campaignId of touchedCampaigns) {
    await maybeCompleteMarketingCampaign(campaignId)
  }

  return { sent, failed }
}

/**
 * Registra resposta recebida do paciente (via webhook).
 * Retorna o id da mensagem criada, ou null se o remetente não é paciente
 * cadastrado (nesse caso nada é arquivado).
 */
export async function registerIncoming(
  from: string,
  content: string,
  receivedAt: Date
): Promise<string | null> {
  const normalized = normalizePhone(from)
  // Pré-filtra pelos últimos 9 dígitos (usa o índice do banco) e compara os
  // dígitos exatos em memória — o contains antigo casava número parcial.
  const lastDigits = normalized.slice(-9)
  const candidates = await prisma.patient.findMany({
    where: { phone: { endsWith: lastDigits } },
    select: { id: true, phone: true },
  })
  const patient = candidates.find(
    (candidate) =>
      candidate.phone && normalizePhone(candidate.phone) === normalized
  )

  if (!patient) {
    console.log(`[WhatsApp] Mensagem de número não cadastrado: ${normalized}`)
    return null
  }

  const created = await prisma.message.create({
    data: {
      patientId: patient.id,
      type: "RESPOSTA",
      direction: "IN",
      content,
      status: "ENTREGUE",
      createdAt: receivedAt,
    },
  })

  return created.id
}
