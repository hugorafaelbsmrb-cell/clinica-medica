/**
 * Serviço do bot de atendimento: orquestra a sessão, busca os dados
 * (consultas pelo CPF) e envia a resposta pelo provedor ativo.
 * Chamado pelo webhook do WhatsApp após registrar a mensagem recebida.
 */
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { prisma } from "@/lib/prisma"
import { getClinicSettings } from "@/lib/clinic"
import { notifyAttendantNeeded } from "@/lib/notifications"
import {
  getWhatsAppProvider,
  normalizePhone,
  isValidIndividualPhone,
  type WhatsAppButton,
} from "./provider"
import { sendTextSmart, extractLinks, downloadImageAsDataUrl } from "./message-service"
import { normalizeText, runBotFlow, type BotState } from "./flow-engine"
import { buildBotFlow } from "./flow-defaults"
import {
  menuNodeId,
  parseFlowEdges,
  parseFlowNodes,
  type FlowRecord,
} from "./flow-types"
import { isPhonePaused, pauseBotForPhone } from "./bot-pause"

const SESSION_TTL_MS = 15 * 60 * 1000 // sessão expira após 15 minutos

/** Estados válidos de sessão (inclui os novos estados do portão). */
const VALID_STATES: BotState[] = [
  "MENU",
  "AGUARDANDO_CPF",
  "AGUARDANDO_NOME",
  "AGUARDANDO_TIPO",
]

/** Grava o estado da sessão do bot (upsert por telefone). */
async function saveBotSession(phone: string, state: BotState): Promise<void> {
  await prisma.botSession.upsert({
    where: { phone },
    update: { state },
    create: { phone, state },
  })
}

/**
 * Carrega o fluxo BOT do banco. Sem fluxo salvo (ou desligado), monta o
 * grafo padrão em memória com os textos históricos de ClinicSettings —
 * o bot nunca fica sem resposta.
 */
async function loadBotFlow(
  clinic: Awaited<ReturnType<typeof getClinicSettings>>
): Promise<FlowRecord> {
  const row = await prisma.messageFlow.findFirst({
    where: { kind: "BOT", enabled: true },
  })
  if (row) {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      description: row.description,
      enabled: row.enabled,
      nodes: parseFlowNodes(row.nodes),
      edges: parseFlowEdges(row.edges),
    }
  }
  return buildBotFlow({
    boasVindas: clinic.botMsgBoasVindas,
    agendar: clinic.botMsgAgendar,
    atendente: clinic.botMsgAtendente,
    saude: clinic.botMsgSaude,
    phone: clinic.phone,
  })
}

/**
 * Processa uma mensagem recebida e responde o paciente.
 * `incomingMessageId` é o id da mensagem registrada no painel (se o
 * remetente for paciente cadastrado) — usado para marcar "atenção".
 */
export async function handleBotMessage(
  from: string,
  content: string,
  incomingMessageId: string | null
): Promise<void> {
  const phone = normalizePhone(from)
  const text = normalizeText(content)
  if (!text) return

  // Grupos do WhatsApp e números fora do formato brasileiro não viram
  // lead: o bot, o follow-up e a tela de Leads atendem só pessoas físicas.
  if (!isValidIndividualPhone(phone)) return

  const clinic = await getClinicSettings()

  // Registra o contato para o follow-up de silêncio: quem só manda
  // mensagem no WhatsApp (sem ser paciente) ganha lembretes de agendamento.
  if (incomingMessageId === null) {
    const hasAttempt = await prisma.registrationAttempt.findUnique({
      where: { phone },
      select: { id: true },
    })
    // Quem já iniciou o cadastro online tem o follow-up próprio — não
    // duplicamos lembretes.
    if (!hasAttempt) {
      await prisma.whatsAppContact.upsert({
        where: { phone },
        // Nova mensagem zera o timer de silêncio.
        update: { lastMessageAt: new Date(), followUpStage: 0 },
        create: { phone },
      })
    }
  } else {
    // Já é paciente: encerra o follow-up do contato, se existir.
    await prisma.whatsAppContact.updateMany({
      where: { phone, converted: false },
      data: { converted: true },
    })
  }

  // Bot desligado: a mensagem fica registrada no painel, mas sem resposta automática.
  if (clinic.botEnabled === false) return

  // Conversa em atendimento humano (bot pausado): a mensagem fica
  // registrada no painel, mas o bot permanece em silêncio até o prazo
  // da pausa vencer (retomada automática).
  if (await isPhonePaused(phone)) return

  // Estado da sessão (ignora sessões expiradas)
  const session = await prisma.botSession.findUnique({ where: { phone } })
  const state: BotState =
    session && Date.now() - session.updatedAt.getTime() <= SESSION_TTL_MS &&
    VALID_STATES.includes(session.state as BotState)
      ? (session.state as BotState)
      : "MENU"

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

  const provider = await getWhatsAppProvider()

  // ---- Portão de identificação (nós PEDIR_NOME/PORTAO no grafo do bot):
  // quem ainda não é paciente informa o nome e escolhe entre "já sou
  // paciente" e "primeira consulta" antes do menu. Pacientes (mensagem
  // registrada, telefone cadastrado ou contato já convertido) seguem
  // direto para o menu — nada muda para eles. ----
  const contact = await prisma.whatsAppContact.findUnique({ where: { phone } })
  const patientByPhone = await prisma.patient.findFirst({
    where: { phone: { contains: phone.slice(2) } },
    select: { id: true },
  })
  const isPatient =
    incomingMessageId !== null ||
    Boolean(patientByPhone) ||
    contact?.converted === true

  const flow = await loadBotFlow(clinic)

  let leadLink: string | null = null
  let knownName = contact?.name?.trim() ?? ""
  if (!isPatient) {
    // Garante o contato para o link personalizado. O follow-up de silêncio
    // já ignora quem tem tentativa de cadastro aberta — sem duplicar.
    const ensured = await prisma.whatsAppContact.upsert({
      where: { phone },
      update: {},
      create: { phone },
    })
    leadLink = `${baseUrl}/cadastro?lead=${ensured.id}`
    knownName = ensured.name?.trim() ?? ""
    if (!knownName) {
      // Aproveita o nome informado no cadastro online: segue para o portão.
      const attemptName = (
        await prisma.registrationAttempt.findUnique({
          where: { phone },
          select: { name: true },
        })
      )?.name?.trim()
      if (attemptName) {
        await prisma.whatsAppContact.update({
          where: { phone },
          data: { name: attemptName, lastMessageAt: new Date(), followUpStage: 0 },
        })
        knownName = attemptName
      }
    }
  }

  // Fluxo com portão: desconhecido sem nome começa no PEDIR_NOME; os
  // demais (pacientes e contatos com nome) caem direto no menu.
  const hasGateway = flow.nodes.some((n) => n.kind === "PEDIR_NOME")
  const startNodeId =
    hasGateway && !isPatient && !knownName
      ? undefined
      : (menuNodeId(flow) ?? undefined)

  const result = runBotFlow(
    state,
    content,
    {
      clinicName: clinic.name,
      address: clinic.address,
      phone: clinic.phone,
      email: clinic.email,
      horarioAtendimento: clinic.horarioAtendimento,
      baseUrl,
      firstName: knownName.split(" ")[0] || null,
      leadLink,
    },
    flow,
    startNodeId
  )

  // Nome capturado pelo portão: grava no contato do lead.
  if (result.capturedName) {
    await prisma.whatsAppContact.update({
      where: { phone },
      data: { name: result.capturedName, lastMessageAt: new Date(), followUpStage: 0 },
    })
  }

  let reply = result.reply
  // Lead (não paciente): todo link de cadastro vira o link personalizado
  // do contato — nome e telefone chegam preenchidos na página. O marcador
  // evita dupla personalização: {{link_lead}} já virou o link com ?lead=X
  // no motor, e um replaceAll simples criaria ?lead=X?lead=X.
  if (leadLink) {
    const marker = "\u0001"
    reply = reply
      .split(leadLink)
      .join(marker)
      .replaceAll(`${baseUrl}/cadastro`, leadLink)
      .split(marker)
      .join(leadLink)
  }
  if (result.cpfLookup) {
    reply = await buildCpfReply(
      result.cpfLookup,
      baseUrl,
      clinic.name,
      clinic.botMsgCpfNaoEncontrado
    )
  }

  // Persiste o próximo estado da sessão
  await saveBotSession(phone, result.nextState)

  // Marca a mensagem no painel para a equipe dar atenção e avisa a
  // equipe pelo sino de notificações
  if (result.needsAttention && incomingMessageId) {
    const flagged = await prisma.message.update({
      where: { id: incomingMessageId },
      data: { needsAttention: true },
      select: {
        patientId: true,
        content: true,
        patient: { select: { name: true } },
      },
    })
    // Mensagem recebida sempre tem paciente; o guard protege o tipo do
    // Prisma (patientId virou opcional por causa das mensagens de lead).
    if (flagged.patientId) {
      await notifyAttendantNeeded(
        flagged.patientId,
        flagged.patient?.name ?? "Paciente",
        flagged.content
      )
    }
  }

  // O paciente pediu um atendente: o bot se cala na conversa (pausa) e
  // volta sozinho após o prazo configurado — a equipe não é incomodada
  // por respostas automáticas enquanto assume o atendimento.
  if (result.needsAttention) {
    await pauseBotForPhone(phone, "pediu_atendente")
  }

  if (reply) {
    // Botões de resposta rápida do portão + botões de link das respostas
    // (ex.: /cadastro vira "Fazer agendamento"); se o botão falhar, cai
    // automaticamente para texto puro.
    const buttons: WhatsAppButton[] = [...(result.buttons ?? [])]
    for (const url of extractLinks(reply)) {
      buttons.push({
        type: "URL",
        label: url.includes("/cadastro")
          ? "Fazer agendamento"
          : url.includes("/cancelar")
            ? "Remarcar consulta"
            : "Abrir link",
        url,
      })
    }
    // Nó com mídia (imagem/vídeo): envia a mídia com o texto de legenda;
    // se o provedor não suporta ou falha, cai para texto puro.
    let sent: Awaited<ReturnType<typeof sendTextSmart>> | undefined
    if (result.mediaUrl) {
      if (result.mediaType === "VIDEO" && provider.sendVideo) {
        sent = await provider.sendVideo(phone, result.mediaUrl, reply)
      } else if (result.mediaType === "IMAGEM" && provider.sendImage) {
        const dataUrl = await downloadImageAsDataUrl(result.mediaUrl)
        if (dataUrl) sent = await provider.sendImage(phone, reply, dataUrl)
      }
    }
    if (!sent?.ok) {
      sent = await sendTextSmart(provider, phone, reply, buttons)
    }
    if (!sent.ok) {
      console.error(`[Bot] Falha ao responder ${phone}: ${sent.error}`)
    }
  }
}

/** Monta a resposta com as consultas do paciente localizadas pelo CPF. */
async function buildCpfReply(
  cpf: string,
  baseUrl: string,
  clinicName: string,
  msgNaoEncontrado?: string | null
): Promise<string> {
  const digits = cpf.replace(/\D/g, "")
  const formatted = `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(
    6,
    9
  )}-${digits.slice(9)}`

  const patient = await prisma.patient.findFirst({
    where: { cpf: { in: [digits, formatted] } },
    select: { id: true, name: true },
  })

  if (!patient) {
    if (msgNaoEncontrado?.trim()) {
      return msgNaoEncontrado.trim().replaceAll("{{clinica}}", clinicName)
    }
    return [
      "Não encontrei um cadastro com este CPF.",
      `Você pode se cadastrar e agendar pelo site: ${baseUrl}/cadastro`,
      'Se preferir, escreva "atendente" para falar com a nossa equipe.',
    ].join("\n")
  }

  const next = await prisma.attendance.findFirst({
    where: {
      patientId: patient.id,
      status: "AGENDADO",
      scheduledAt: { gt: new Date() },
    },
    orderBy: { scheduledAt: "asc" },
  })

  const firstName = patient.name.split(" ")[0]

  if (next) {
    const data = format(next.scheduledAt, "dd/MM/yyyy 'às' HH:mm", {
      locale: ptBR,
    })
    return [
      `${firstName}, sua próxima consulta está marcada para ${data}.`,
      `Para remarcar, acesse: ${baseUrl}/cancelar/${next.cancelToken ?? ""}`,
    ].join("\n")
  }

  return [
    `${firstName}, não encontrei consultas agendadas para você.`,
    `Para agendar uma consulta, acesse: ${baseUrl}/cadastro`,
  ].join("\n")
}
