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
import { getWhatsAppProvider, normalizePhone } from "./provider"
import { sendTextSmart, extractLinks, downloadImageAsDataUrl } from "./message-service"
import { normalizeText, runBotFlow, type BotState } from "./flow-engine"
import { buildBotFlow } from "./flow-defaults"
import {
  parseFlowEdges,
  parseFlowNodes,
  type FlowRecord,
} from "./flow-types"
import { isPhonePaused, pauseBotForPhone } from "./bot-pause"

const SESSION_TTL_MS = 15 * 60 * 1000 // sessão expira após 15 minutos

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
  let state: BotState = "MENU"
  const session = await prisma.botSession.findUnique({ where: { phone } })
  if (session && Date.now() - session.updatedAt.getTime() <= SESSION_TTL_MS) {
    state = session.state === "AGUARDANDO_CPF" ? "AGUARDANDO_CPF" : "MENU"
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

  const flow = await loadBotFlow(clinic)
  const result = runBotFlow(
    state,
    text,
    {
      clinicName: clinic.name,
      address: clinic.address,
      phone: clinic.phone,
      email: clinic.email,
      horarioAtendimento: clinic.horarioAtendimento,
      baseUrl,
    },
    flow
  )

  let reply = result.reply
  if (result.cpfLookup) {
    reply = await buildCpfReply(
      result.cpfLookup,
      baseUrl,
      clinic.name,
      clinic.botMsgCpfNaoEncontrado
    )
  }

  // Persiste o próximo estado da sessão
  await prisma.botSession.upsert({
    where: { phone },
    update: { state: result.nextState },
    create: { phone, state: result.nextState },
  })

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
    await notifyAttendantNeeded(
      flagged.patientId,
      flagged.patient.name,
      flagged.content
    )
  }

  // O paciente pediu um atendente: o bot se cala na conversa (pausa) e
  // volta sozinho após o prazo configurado — a equipe não é incomodada
  // por respostas automáticas enquanto assume o atendimento.
  if (result.needsAttention) {
    await pauseBotForPhone(phone, "pediu_atendente")
  }

  if (reply) {
    const provider = await getWhatsAppProvider()
    // Respostas com link (ex.: /cadastro) viram texto com botão de rótulo
    // intuitivo conforme o destino; se o botão falhar, cai automaticamente
    // para texto puro.
    const buttons = extractLinks(reply).map((url) => ({
      type: "URL" as const,
      label: url.includes("/cadastro")
        ? "Fazer agendamento"
        : url.includes("/cancelar")
          ? "Remarcar consulta"
          : "Abrir link",
      url,
    }))
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
