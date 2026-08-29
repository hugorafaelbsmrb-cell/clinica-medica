/**
 * Automações de mensagens do WhatsApp (cron).
 *
 * Executadas pelo worker /api/cron/send-messages a cada 10 minutos:
 *  1. Cadastro incompleto — lembretes em 30 min, 1h e 2h para quem
 *     iniciou o pré-cadastro online e não finalizou.
 *  2. Tratamento — mensagem periódica para pacientes em tratamento
 *     (com consulta realizada nos últimos 90 dias).
 *  3. Aniversário — mensagem no dia do aniversário do paciente.
 *  4. Reativação — mensagem para clientes com a última consulta
 *     há mais de X dias.
 *  5. Pagamento pendente — lembrete para cobranças avulsas ainda não
 *     pagas depois do tempo definido pelo admin. Cobranças de agendamento
 *     online seguem o follow-up próprio (payment-follow-up.ts).
 *
 * As mensagens usam a fila (tabela Message) sempre que há paciente
 * cadastrado; para tentativas de cadastro o envio é direto, pois ainda
 * não existe registro de paciente.
 */
import { prisma } from "@/lib/prisma"
import { getClinicSettings } from "@/lib/clinic"
import { paymentPageUrl } from "@/lib/payments/url"
import { getWhatsAppProvider, normalizePhone } from "./provider"
import {
  renderTemplate,
  enqueueMessage,
  sendImmediateMessage,
  sendTextSmart,
} from "./message-service"

export type AutomationCounts = {
  cadastro: number
  tratamento: number
  aniversario: number
  reativacao: number
  pagamentos: number
}

/** Template padrão de cada automação (quando o admin deixa vazio). */
export function defaultAutomationMessage(
  kind:
    | "tratamento"
    | "aniversario"
    | "reativacao"
    | "agradecimento"
    | "acaminho"
    | "linkpagamento"
    | "lembretepagamento"
    | "pagamentoconfirmado"
): string {
  switch (kind) {
    case "tratamento":
      return "Olá {{nome}}! Aqui é da clínica. Esperamos que esteja tudo bem com você. Qualquer dúvida sobre o seu tratamento, é só responder por aqui."
    case "aniversario":
      return "Olá {{nome}}! A equipe da clínica deseja um feliz aniversário! Muita saúde e um excelente ano novo de vida. 🎉"
    case "reativacao":
      return "Olá {{nome}}! Faz um tempo que não nos vemos. Que tal agendar uma consulta para cuidar da sua saúde? É só responder por aqui."
    case "agradecimento":
      return "Olá {{nome}}! Obrigado pela sua visita. Sua opinião é muito importante para nós — se precisar de algo, é só responder por aqui."
    case "acaminho":
      return "Olá {{nome}}! O médico já está a caminho da sua casa."
    case "linkpagamento":
      return "Olá {{nome}}! Reservamos seu horário. Para confirmar a consulta, faça o pagamento de R$ {{valor}} por aqui: {{link}}"
    case "lembretepagamento":
      return "Olá {{nome}}! Seu horário ainda está reservado, mas falta o pagamento de R$ {{valor}} para confirmar a consulta. Pague por aqui: {{link}}"
    case "pagamentoconfirmado":
      return "Olá {{nome}}! Recebemos seu pagamento de R$ {{valor}}. Tudo certo!"
  }
}

/** Marcos do follow-up de cadastro em minutos após o início (30 min, 1h e 2h). */
const CADASTRO_FOLLOW_UP_MINUTES = [30, 60, 120] as const

/** Template padrão de cada lembrete do cadastro incompleto (admin edita). */
function defaultCadastroFollowUpMessage(stage: 1 | 2 | 3): string {
  switch (stage) {
    case 1:
      return "Olá {{nome}}! 😊 Seu cadastro ficou no meio do caminho, mas sua saúde não precisa esperar. Faltam poucos passos para garantir sua consulta. Continue por aqui: {{link}}"
    case 2:
      return "Oi {{nome}}! 💙 Cuidar da saúde é o melhor presente que você pode se dar hoje. Sua consulta está a poucos cliques — vamos concluir seu cadastro? {{link}}"
    case 3:
      return "{{nome}}, deixar a saúde para depois pode sair caro. 🩺 Nossa equipe está pronta para cuidar de você — termine seu cadastro em 2 minutinhos e garanta seu horário: {{link}}"
  }
}

/**
 * 1) Cadastro incompleto: lembretes em 30 minutos, 1 hora e 2 horas após
 *    o início do pré-cadastro (mesmo padrão do follow-up de pagamento).
 *    Envio direto (sem paciente). Após o 3º lembrete, encerra sem cancelar.
 */
async function processCadastroIncompleto(
  clinic: Awaited<ReturnType<typeof getClinicSettings>>,
  now: Date
): Promise<number> {
  if (!clinic.autoCadastroEnabled) return 0

  const attempts = await prisma.registrationAttempt.findMany({
    where: {
      converted: false,
      followUpStage: { lte: 3 },
      phone: { not: "" },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  })
  if (attempts.length === 0) return 0

  const provider = await getWhatsAppProvider()
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://painel.medicoemdomicilio.com"
  const link = `${baseUrl}/cadastro`
  const msgs = [
    clinic.autoCadastroMsg?.trim() || defaultCadastroFollowUpMessage(1),
    clinic.autoCadastroFollowUp2Msg?.trim() || defaultCadastroFollowUpMessage(2),
    clinic.autoCadastroFollowUp3Msg?.trim() || defaultCadastroFollowUpMessage(3),
  ]

  let sent = 0
  for (const attempt of attempts) {
    const ageMinutes = (now.getTime() - attempt.createdAt.getTime()) / 60000
    const stage = attempt.followUpStage

    // No máximo um avanço por execução do cron (se o cron perdeu
    // execuções, o lembrete anterior é pulado).
    let nextStage: number | null = null
    if (
      stage === 0 &&
      ageMinutes >= CADASTRO_FOLLOW_UP_MINUTES[0] &&
      ageMinutes < CADASTRO_FOLLOW_UP_MINUTES[1]
    ) {
      nextStage = 1
    } else if (
      stage <= 1 &&
      ageMinutes >= CADASTRO_FOLLOW_UP_MINUTES[1] &&
      ageMinutes < CADASTRO_FOLLOW_UP_MINUTES[2]
    ) {
      nextStage = 2
    } else if (stage <= 2 && ageMinutes >= CADASTRO_FOLLOW_UP_MINUTES[2]) {
      nextStage = 3
    }
    if (nextStage === null) continue

    const content = renderTemplate(msgs[nextStage - 1], {
      nome: attempt.name?.split(" ")[0] || "paciente",
      data: now.toLocaleDateString("pt-BR"),
      link,
    })
    const result = await sendTextSmart(
      provider,
      normalizePhone(attempt.phone),
      content
    )

    if (result.ok) {
      await prisma.registrationAttempt.update({
        where: { id: attempt.id },
        data: {
          contacted: true,
          contactedAt: now,
          // Após o 3º lembrete (2h), encerra: sem cancelamento e sem novos envios.
          followUpStage: nextStage === 3 ? 4 : nextStage,
        },
      })
      sent++
    }
  }

  return sent
}

/**
 * 2) Tratamento periódico: pacientes com consulta REALIZADA nos últimos
 *    90 dias, sem mensagem periódica no intervalo definido pelo admin.
 */
async function processTratamentoPeriodico(
  clinic: Awaited<ReturnType<typeof getClinicSettings>>,
  now: Date
): Promise<number> {
  if (!clinic.autoTratamentoEnabled) return 0
  const intervalDays = clinic.autoTratamentoIntervalDays ?? 7
  const activeSince = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  const lastSentBefore = new Date(
    now.getTime() - intervalDays * 24 * 60 * 60 * 1000
  )

  const patients = await prisma.patient.findMany({
    where: {
      whatsappEnabled: true,
      lgpdConsent: true,
      phone: { not: null },
      attendances: { some: { status: "REALIZADO", scheduledAt: { gte: activeSince } } },
    },
    select: { id: true, name: true },
  })
  if (patients.length === 0) return 0

  const msg = clinic.autoTratamentoMsg?.trim() || defaultAutomationMessage("tratamento")
  let queued = 0

  for (const patient of patients) {
    const last = await prisma.message.findFirst({
      where: {
        patientId: patient.id,
        type: "TRATAMENTO_PERIODICO",
        createdAt: { gt: lastSentBefore },
      },
    })
    if (last) continue

    await enqueueMessage(
      patient.id,
      "TRATAMENTO_PERIODICO",
      renderTemplate(msg, {
        nome: patient.name.split(" ")[0],
        data: now.toLocaleDateString("pt-BR"),
      }),
      now
    )
    queued++
  }

  return queued
}

/**
 * 3) Aniversário: pacientes com aniversário hoje, no máximo uma vez por ano.
 */
async function processAniversario(
  clinic: Awaited<ReturnType<typeof getClinicSettings>>,
  now: Date
): Promise<number> {
  if (!clinic.autoAniversarioEnabled) return 0

  const month = now.getMonth() + 1
  const day = now.getDate()
  const yearStart = new Date(now.getFullYear(), 0, 1)

  // Filtra por mês/dia no banco e confirma o dia exato em memória.
  const patients = await prisma.patient.findMany({
    where: {
      whatsappEnabled: true,
      lgpdConsent: true,
      phone: { not: null },
      birthDate: { not: null },
    },
    select: { id: true, name: true, birthDate: true },
  })
  const aniversariantes = patients.filter(
    (p) =>
      p.birthDate &&
      p.birthDate.getMonth() + 1 === month &&
      p.birthDate.getDate() === day
  )
  if (aniversariantes.length === 0) return 0

  const msg = clinic.autoAniversarioMsg?.trim() || defaultAutomationMessage("aniversario")
  let queued = 0

  for (const patient of aniversariantes) {
    const already = await prisma.message.findFirst({
      where: {
        patientId: patient.id,
        type: "ANIVERSARIO",
        createdAt: { gte: yearStart },
      },
    })
    if (already) continue

    await enqueueMessage(
      patient.id,
      "ANIVERSARIO",
      renderTemplate(msg, {
        nome: patient.name.split(" ")[0],
        data: now.toLocaleDateString("pt-BR"),
      }),
      now
    )
    queued++
  }

  return queued
}

/**
 * 4) Reativação: clientes (com consulta REALIZADA) cuja última consulta
 *    aconteceu há mais de X dias, sem mensagem de reativação no período.
 */
async function processReativacao(
  clinic: Awaited<ReturnType<typeof getClinicSettings>>,
  now: Date
): Promise<number> {
  if (!clinic.autoReativacaoEnabled) return 0
  const days = clinic.autoReativacaoDays ?? 60
  const lastAttendanceBefore = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  const patients = await prisma.patient.findMany({
    where: {
      whatsappEnabled: true,
      lgpdConsent: true,
      phone: { not: null },
      attendances: { some: { status: "REALIZADO" } },
    },
    select: {
      id: true,
      name: true,
      attendances: {
        where: { status: "REALIZADO" },
        orderBy: { scheduledAt: "desc" },
        take: 1,
        select: { scheduledAt: true },
      },
    },
  })
  const inativos = patients.filter(
    (p) => p.attendances[0] && p.attendances[0].scheduledAt < lastAttendanceBefore
  )
  if (inativos.length === 0) return 0

  const msg = clinic.autoReativacaoMsg?.trim() || defaultAutomationMessage("reativacao")
  let queued = 0

  for (const patient of inativos) {
    const already = await prisma.message.findFirst({
      where: {
        patientId: patient.id,
        type: "REATIVACAO",
        createdAt: { gt: lastAttendanceBefore },
      },
    })
    if (already) continue

    await enqueueMessage(
      patient.id,
      "REATIVACAO",
      renderTemplate(msg, {
        nome: patient.name.split(" ")[0],
        data: now.toLocaleDateString("pt-BR"),
      }),
      now
    )
    queued++
  }

  return queued
}

/**
 * 5) Pagamentos pendentes: lembrete (uma única vez por cobrança) para quem
 *    recebeu cobrança avulsa e não pagou dentro do tempo definido.
 *    Cobranças vinculadas a agendamento online são tratadas pelo follow-up
 *    próprio (lib/whatsapp/payment-follow-up.ts).
 */
async function processPagamentosPendentes(
  clinic: Awaited<ReturnType<typeof getClinicSettings>>,
  now: Date
): Promise<number> {
  if (!clinic.autoPagamentoLembreteEnabled) return 0
  const delayMinutes = clinic.autoPagamentoLembreteDelayMinutes ?? 60
  const cutoff = new Date(now.getTime() - delayMinutes * 60 * 1000)

  const payments = await prisma.payment.findMany({
    where: {
      status: "PENDENTE",
      remindedAt: null,
      attendanceId: null,
      createdAt: { lte: cutoff },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  })
  if (payments.length === 0) return 0

  const msg =
    clinic.autoPagamentoLembreteMsg?.trim() ||
    defaultAutomationMessage("lembretepagamento")

  let queued = 0
  for (const payment of payments) {
    const patientId = payment.patientId
    if (!patientId) continue

    const patient = await prisma.patient.findUnique({ where: { id: patientId } })
    if (!patient?.phone || !patient.whatsappEnabled || !patient.lgpdConsent) {
      continue
    }

    const link = paymentPageUrl(payment.id)
    await enqueueMessage(
      patientId,
      "LEMBRETE_PAGAMENTO",
      renderTemplate(msg, {
        nome: patient.name.split(" ")[0],
        valor: Number(payment.amount).toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
        }),
        link,
      }),
      now
    )
    await prisma.payment.update({
      where: { id: payment.id },
      data: { remindedAt: now },
    })
    queued++
  }

  return queued
}

/**
 * Roda todas as automações periódicas. Chamado pelo cron junto com a fila.
 */
export async function queueAutomationMessages(
  now = new Date()
): Promise<AutomationCounts> {
  const clinic = await getClinicSettings()

  const cadastro = await processCadastroIncompleto(clinic, now)
  const tratamento = await processTratamentoPeriodico(clinic, now)
  const aniversario = await processAniversario(clinic, now)
  const reativacao = await processReativacao(clinic, now)
  const pagamentos = await processPagamentosPendentes(clinic, now)

  return { cadastro, tratamento, aniversario, reativacao, pagamentos }
}

/**
 * Envia o link de pagamento por WhatsApp assim que o horário é reservado
 * no agendamento online (o próprio serviço checa consentimento LGPD).
 * Envio imediato para o paciente não esperar o ciclo do cron.
 */
export async function queuePaymentLinkMessage(
  patientId: string,
  payment: {
    checkoutUrl: string | null
    pixCopiaCola: string | null
    /** Página de pagamento do próprio sistema (preferida, quando existe). */
    paymentUrl?: string | null
    amount: number
  }
): Promise<void> {
  const clinic = await getClinicSettings()
  if (!clinic.autoPagamentoLinkEnabled) return

  const patient = await prisma.patient.findUnique({ where: { id: patientId } })
  if (!patient?.phone || !patient.whatsappEnabled || !patient.lgpdConsent) return

  const msg =
    clinic.autoPagamentoLinkMsg?.trim() || defaultAutomationMessage("linkpagamento")
  const link = payment.paymentUrl ?? payment.checkoutUrl ?? payment.pixCopiaCola ?? ""

  await sendImmediateMessage(
    patientId,
    "LINK_PAGAMENTO",
    renderTemplate(msg, {
      nome: patient.name.split(" ")[0],
      valor: payment.amount.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
      }),
      link,
    }),
    undefined,
    // Botão "Pagar agora" só com link http(s); copia-e-cola PIX segue no texto.
    link.startsWith("http")
      ? [{ type: "URL", label: "Pagar agora", url: link }]
      : undefined
  )
}

/**
 * Agradecimento pós-consulta: chamado ao marcar o atendimento como REALIZADO.
 * Exige consentimento LGPD e WhatsApp habilitado.
 */
export async function queueThankYouMessage(patientId: string): Promise<boolean> {
  const clinic = await getClinicSettings()
  if (!clinic.autoAgradecimentoEnabled) return false

  const patient = await prisma.patient.findUnique({ where: { id: patientId } })
  if (!patient?.phone || !patient.whatsappEnabled || !patient.lgpdConsent) {
    return false
  }

  const msg =
    clinic.autoAgradecimentoMsg?.trim() || defaultAutomationMessage("agradecimento")

  await enqueueMessage(
    patientId,
    "AGRADECIMENTO",
    renderTemplate(msg, {
      nome: patient.name.split(" ")[0],
      data: new Date().toLocaleDateString("pt-BR"),
    }),
    new Date()
  )
  return true
}
