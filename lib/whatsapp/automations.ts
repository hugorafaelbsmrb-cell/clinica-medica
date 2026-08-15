/**
 * Automações de mensagens do WhatsApp (cron).
 *
 * Executadas pelo worker /api/cron/send-messages a cada 10 minutos:
 *  1. Cadastro incompleto — lembra quem iniciou o pré-cadastro online,
 *     informou o telefone e não finalizou.
 *  2. Tratamento — mensagem periódica para pacientes em tratamento
 *     (com consulta realizada nos últimos 90 dias).
 *  3. Aniversário — mensagem no dia do aniversário do paciente.
 *  4. Reativação — mensagem para clientes com a última consulta
 *     há mais de X dias.
 *  5. Pagamento pendente — lembrete para quem reservou/cobrou e ainda
 *     não pagou depois do tempo definido pelo admin.
 *
 * As mensagens usam a fila (tabela Message) sempre que há paciente
 * cadastrado; para tentativas de cadastro o envio é direto, pois ainda
 * não existe registro de paciente.
 */
import { prisma } from "@/lib/prisma"
import { getClinicSettings } from "@/lib/clinic"
import { getWhatsAppProvider, normalizePhone } from "./provider"
import { renderTemplate, enqueueMessage } from "./message-service"

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
    | "cadastro"
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
    case "cadastro":
      return "Olá {{nome}}! Percebemos que você começou seu cadastro na clínica e não finalizou. Se precisar de ajuda ou preferir fazer pelo WhatsApp, é só responder esta mensagem."
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

/**
 * 1) Cadastro incompleto: tenta enviar lembrete para tentativas antigas
 *    não convertidas e ainda não contatadas. Envio direto (sem paciente).
 */
async function processCadastroIncompleto(
  clinic: Awaited<ReturnType<typeof getClinicSettings>>,
  now: Date
): Promise<number> {
  if (!clinic.autoCadastroEnabled) return 0
  const delayHours = clinic.autoCadastroDelayHours ?? 24
  const cutoff = new Date(now.getTime() - delayHours * 60 * 60 * 1000)

  const attempts = await prisma.registrationAttempt.findMany({
    where: {
      converted: false,
      contacted: false,
      createdAt: { lte: cutoff },
      phone: { not: "" },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  })
  if (attempts.length === 0) return 0

  const provider = await getWhatsAppProvider()
  const msg = clinic.autoCadastroMsg?.trim() || defaultAutomationMessage("cadastro")

  let sent = 0
  for (const attempt of attempts) {
    const content = renderTemplate(msg, {
      nome: attempt.name?.split(" ")[0] || "paciente",
      data: now.toLocaleDateString("pt-BR"),
    })
    const result = await provider.sendText(normalizePhone(attempt.phone), content)

    if (result.ok) {
      await prisma.registrationAttempt.update({
        where: { id: attempt.id },
        data: { contacted: true, contactedAt: now },
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
 *    reservou ou recebeu cobrança e não pagou dentro do tempo definido.
 *    Também varre cobranças vencidas e libera horários reservados.
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
      createdAt: { lte: cutoff },
    },
    include: {
      attendance: { select: { patientId: true, status: true } },
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
    // Horário já foi cancelado/liberado: encerra a cobrança e não lembra
    if (payment.attendance && payment.attendance.status !== "AGUARDANDO_PAGAMENTO") {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "CANCELADO" },
      })
      continue
    }

    const patientId = payment.patientId ?? payment.attendance?.patientId
    if (!patientId) continue

    const patient = await prisma.patient.findUnique({ where: { id: patientId } })
    if (!patient?.phone || !patient.whatsappEnabled || !patient.lgpdConsent) {
      continue
    }

    const link = payment.checkoutUrl ?? payment.pixCopiaCola ?? ""
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
 */
export async function queuePaymentLinkMessage(
  patientId: string,
  payment: {
    checkoutUrl: string | null
    pixCopiaCola: string | null
    amount: number
  }
): Promise<void> {
  const clinic = await getClinicSettings()
  if (!clinic.autoPagamentoLinkEnabled) return

  const patient = await prisma.patient.findUnique({ where: { id: patientId } })
  if (!patient?.phone || !patient.whatsappEnabled || !patient.lgpdConsent) return

  const msg =
    clinic.autoPagamentoLinkMsg?.trim() || defaultAutomationMessage("linkpagamento")
  const link = payment.checkoutUrl ?? payment.pixCopiaCola ?? ""

  await enqueueMessage(
    patientId,
    "LINK_PAGAMENTO",
    renderTemplate(msg, {
      nome: patient.name.split(" ")[0],
      valor: payment.amount.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
      }),
      link,
    }),
    new Date()
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
