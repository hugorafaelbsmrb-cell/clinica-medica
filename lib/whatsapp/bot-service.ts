/**
 * Serviço do bot de atendimento: orquestra a sessão, busca os dados
 * (consultas pelo CPF) e envia a resposta pelo provedor ativo.
 * Chamado pelo webhook do WhatsApp após registrar a mensagem recebida.
 */
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { prisma } from "@/lib/prisma"
import { getClinicSettings } from "@/lib/clinic"
import { getWhatsAppProvider, normalizePhone } from "./provider"
import { normalizeText, runBot, type BotState } from "./bot-engine"

const SESSION_TTL_MS = 15 * 60 * 1000 // sessão expira após 15 minutos

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

  // Bot desligado: a mensagem fica registrada no painel, mas sem resposta automática.
  if (clinic.botEnabled === false) return

  // Estado da sessão (ignora sessões expiradas)
  let state: BotState = "MENU"
  const session = await prisma.botSession.findUnique({ where: { phone } })
  if (session && Date.now() - session.updatedAt.getTime() <= SESSION_TTL_MS) {
    state = session.state === "AGUARDANDO_CPF" ? "AGUARDANDO_CPF" : "MENU"
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

  const result = runBot(state, text, {
    clinicName: clinic.name,
    address: clinic.address,
    phone: clinic.phone,
    email: clinic.email,
    horarioAtendimento: clinic.horarioAtendimento,
    baseUrl,
    msgAtendente: clinic.botMsgAtendente,
    msgSaude: clinic.botMsgSaude,
    msgBoasVindas: clinic.botMsgBoasVindas,
    msgAgendar: clinic.botMsgAgendar,
  })

  let reply = result.reply
  if (result.cpfLookup) {
    reply = await buildCpfReply(result.cpfLookup, baseUrl, clinic.botMsgCpfNaoEncontrado)
  }

  // Persiste o próximo estado da sessão
  await prisma.botSession.upsert({
    where: { phone },
    update: { state: result.nextState },
    create: { phone, state: result.nextState },
  })

  // Marca a mensagem no painel para a equipe dar atenção
  if (result.needsAttention && incomingMessageId) {
    await prisma.message.update({
      where: { id: incomingMessageId },
      data: { needsAttention: true },
    })
  }

  if (reply) {
    const provider = await getWhatsAppProvider()
    const sent = await provider.sendText(phone, reply)
    if (!sent.ok) {
      console.error(`[Bot] Falha ao responder ${phone}: ${sent.error}`)
    }
  }
}

/** Monta a resposta com as consultas do paciente localizadas pelo CPF. */
async function buildCpfReply(
  cpf: string,
  baseUrl: string,
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
      return msgNaoEncontrado.trim()
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
