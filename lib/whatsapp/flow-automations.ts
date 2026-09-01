/**
 * Automações de mensagens orientadas a fluxos (MessageFlow kind AUTOMACAO).
 *
 * O cron (/api/cron/send-messages) e os hooks de evento (atendimentos,
 * pagamentos) executam aqui: cada fluxo tem um nó GATILHO que define o
 * evento disparador, e a cadeia de MENSAGEMs com arestas de atraso define o
 * que enviar e quando. A lógica de negócio de cada gatilho (dedup por
 * estágio/intervalo/ano/entidade) continua aqui; o conteúdo vem do grafo.
 *
 * Executadas pelo worker a cada 10 minutos:
 *  1. Cadastro incompleto — lembretes por estágio (30 min, 1h e 2h; a cadeia
 *     do fluxo define os marcos — novas mensagens estendem o follow-up).
 *  2. Contato do WhatsApp — mesmo padrão para quem só mandou mensagem.
 *  3. Tratamento — mensagem periódica (config.intervalDays do gatilho).
 *  4. Aniversário — mensagem no dia do aniversário (1x por ano).
 *  5. Reativação — última consulta há mais de config.days dias.
 *  6. Pagamento avulso pendente — lembrete após config.delayMinutes.
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
import { isPhonePaused, sweepExpiredBotPauses } from "./bot-pause"
import {
  parseFlowEdges,
  parseFlowNodes,
  flowMessageChain,
  triggerNode,
  type FlowRecord,
  type GatilhoTipo,
} from "./flow-types"

export type AutomationCounts = {
  cadastro: number
  whatsapp: number
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
      return "Olá {{nome}}! Aqui é da {{clinica}}. Esperamos que esteja tudo bem com você. Qualquer dúvida sobre o seu tratamento, é só responder por aqui."
    case "aniversario":
      return "Olá {{nome}}! A equipe da {{clinica}} deseja um feliz aniversário! Muita saúde e um excelente ano novo de vida. 🎉"
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

/** Template padrão de cada lembrete do cadastro incompleto (admin edita). */
export function defaultCadastroFollowUpMessage(stage: 1 | 2 | 3): string {
  switch (stage) {
    case 1:
      return "Olá {{nome}}! 😊 Seu cadastro ficou no meio do caminho, mas sua saúde não precisa esperar. Faltam poucos passos para garantir sua consulta. Continue por aqui: {{link}}"
    case 2:
      return "Oi {{nome}}! 💙 Cuidar da saúde é o melhor presente que você pode se dar hoje. Sua consulta está a poucos cliques — vamos concluir seu cadastro? {{link}}"
    case 3:
      return "{{nome}}, deixar a saúde para depois pode sair caro. 🩺 Nossa equipe está pronta para cuidar de você — termine seu cadastro em 2 minutinhos e garanta seu horário: {{link}}"
  }
}

/** Template padrão de cada lembrete do contato que só mandou mensagem. */
export function defaultWhatsappFollowUpMessage(stage: 1 | 2 | 3): string {
  switch (stage) {
    case 1:
      return "Oi! 😊 Você falou com a gente aqui no WhatsApp e sumiu — mas a sua saúde não precisa esperar. Que tal agendar sua consulta? É rapidinho: {{link}}"
    case 2:
      return "Cuidar de você é o melhor investimento de hoje. 💙 A {{clinica}} está pronta para te atender — garanta seu horário em 2 minutinhos: {{link}}"
    case 3:
      return "Deixar a saúde para depois pode sair caro. 🩺 Nossa equipe está esperando por você — agende agora: {{link}}"
  }
}

/** Busca o fluxo AUTOMACAO habilitado com o gatilho informado. */
export async function getFlowByGatilho(
  gatilho: GatilhoTipo
): Promise<FlowRecord | null> {
  const rows = await prisma.messageFlow.findMany({
    where: { kind: "AUTOMACAO", enabled: true },
  })
  for (const row of rows) {
    const nodes = parseFlowNodes(row.nodes)
    const trigger = nodes.find((n) => n.kind === "GATILHO")
    if (trigger && trigger.kind === "GATILHO" && trigger.gatilho === gatilho) {
      return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        description: row.description,
        enabled: row.enabled,
        nodes,
        edges: parseFlowEdges(row.edges),
      }
    }
  }
  return null
}

/** Valor numérico de uma chave do config do GATILHO. */
export function gatilhoConfigNumber(
  flow: FlowRecord,
  key: string
): number | null {
  const trigger = triggerNode(flow)
  if (!trigger || trigger.kind !== "GATILHO") return null
  const value = trigger.config?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** Texto da primeira mensagem do fluxo (fallback quando vazio/ausente). */
export function firstFlowMessage(flow: FlowRecord, fallback: string): string {
  const chain = flowMessageChain(flow)
  return chain[0]?.node.content?.trim() || fallback
}

const BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://painel.medicoemdomicilio.com"

/**
 * 1) Cadastro incompleto: lembretes por estágio. Os marcos (minutos após o
 *    início) e os textos vêm da cadeia do fluxo; o estágio segue em
 *    registrationAttempt.followUpStage. No máximo um avanço por execução.
 */
async function processCadastroIncompleto(
  clinic: Awaited<ReturnType<typeof getClinicSettings>>,
  flow: FlowRecord | null,
  now: Date
): Promise<number> {
  if (!flow) return 0
  const chain = flowMessageChain(flow)
  if (chain.length === 0) return 0

  const attempts = await prisma.registrationAttempt.findMany({
    where: {
      converted: false,
      followUpStage: { lte: chain.length },
      phone: { not: "" },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  })
  if (attempts.length === 0) return 0

  const provider = await getWhatsAppProvider()
  const link = `${BASE_URL}/cadastro`
  let sent = 0

  for (const attempt of attempts) {
    const ageMinutes = (now.getTime() - attempt.createdAt.getTime()) / 60000
    const stage = attempt.followUpStage

    // Próximo índice devido: o mais alto cujo marco já passou (se o cron
    // perdeu execuções, o lembrete anterior é pulado).
    let nextIdx: number | null = null
    for (let i = chain.length - 1; i >= 0; i--) {
      if (stage <= i && ageMinutes >= chain[i].dueMinutes) {
        nextIdx = i
        break
      }
    }
    if (nextIdx === null) continue

    // Conversa em atendimento humano: não envia e não avança o estágio —
    // o lembrete reaparece quando o bot voltar.
    if (await isPhonePaused(attempt.phone)) continue

    const content = renderTemplate(chain[nextIdx].node.content || "", {
      nome: attempt.name?.split(" ")[0] || "paciente",
      data: now.toLocaleDateString("pt-BR"),
      link,
      clinica: clinic.name,
    })
    const result = await sendTextSmart(
      provider,
      normalizePhone(attempt.phone),
      content,
      undefined,
      "Fazer agendamento"
    )

    if (result.ok) {
      const isLast = nextIdx === chain.length - 1
      await prisma.registrationAttempt.update({
        where: { id: attempt.id },
        data: {
          contacted: true,
          contactedAt: now,
          // Após o último lembrete, encerra: sem cancelamento e sem novos envios.
          followUpStage: isLast ? chain.length + 1 : nextIdx + 1,
        },
      })
      sent++
    }
  }

  return sent
}

/**
 * 2) Contato do WhatsApp: quem mandou mensagem (sem ser paciente) e ficou
 *    em silêncio recebe os lembretes da cadeia do fluxo.
 */
async function processWhatsAppContacts(
  clinic: Awaited<ReturnType<typeof getClinicSettings>>,
  flow: FlowRecord | null,
  now: Date
): Promise<number> {
  if (!flow) return 0
  const chain = flowMessageChain(flow)
  if (chain.length === 0) return 0

  const contacts = await prisma.whatsAppContact.findMany({
    where: { converted: false, followUpStage: { lte: chain.length } },
    orderBy: { lastMessageAt: "asc" },
    take: 20,
  })
  if (contacts.length === 0) return 0

  const phones = contacts.map((c) => c.phone)
  // Evita duplicar lembretes: quem já é paciente ou tem tentativa de
  // cadastro aberta é coberto por outros fluxos.
  const [patients, attempts] = await Promise.all([
    prisma.patient.findMany({
      where: { phone: { in: phones } },
      select: { phone: true },
    }),
    prisma.registrationAttempt.findMany({
      where: { phone: { in: phones }, converted: false },
      select: { phone: true },
    }),
  ])
  const patientPhones = patients
    .map((p) => p.phone ?? "")
    .filter((p) => p !== "")
  if (patientPhones.length > 0) {
    // Contato já virou paciente: encerra o follow-up.
    await prisma.whatsAppContact.updateMany({
      where: { phone: { in: patientPhones }, converted: false },
      data: { converted: true },
    })
  }
  const skip = new Set([...patientPhones, ...attempts.map((a) => a.phone)])

  const provider = await getWhatsAppProvider()
  const link = `${BASE_URL}/cadastro`
  let sent = 0

  for (const contact of contacts) {
    if (skip.has(contact.phone)) continue

    const ageMinutes =
      (now.getTime() - contact.lastMessageAt.getTime()) / 60000
    const stage = contact.followUpStage

    let nextIdx: number | null = null
    for (let i = chain.length - 1; i >= 0; i--) {
      if (stage <= i && ageMinutes >= chain[i].dueMinutes) {
        nextIdx = i
        break
      }
    }
    if (nextIdx === null) continue

    // Conversa em atendimento humano: não envia e não avança o estágio.
    if (await isPhonePaused(contact.phone)) continue

    const content = renderTemplate(chain[nextIdx].node.content || "", {
      nome: contact.name?.split(" ")[0] || "",
      link,
      clinica: clinic.name,
    })
    const result = await sendTextSmart(
      provider,
      normalizePhone(contact.phone),
      content,
      undefined,
      "Fazer agendamento"
    )

    if (result.ok) {
      const isLast = nextIdx === chain.length - 1
      await prisma.whatsAppContact.update({
        where: { id: contact.id },
        data: {
          contactedAt: now,
          // Após o último lembrete, encerra o follow-up.
          followUpStage: isLast ? chain.length + 1 : nextIdx + 1,
        },
      })
      sent++
    }
  }

  return sent
}

/**
 * 3) Tratamento periódico: pacientes com consulta REALIZADA nos últimos
 *    90 dias, sem mensagem periódica no intervalo configurado no gatilho.
 */
async function processTratamentoPeriodico(
  clinic: Awaited<ReturnType<typeof getClinicSettings>>,
  flow: FlowRecord | null,
  now: Date
): Promise<number> {
  if (!flow) return 0
  const msg = firstFlowMessage(flow, defaultAutomationMessage("tratamento"))
  const intervalDays = gatilhoConfigNumber(flow, "intervalDays") ?? 7
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
        clinica: clinic.name,
      }),
      now
    )
    queued++
  }

  return queued
}

/**
 * 4) Aniversário: pacientes com aniversário hoje, no máximo uma vez por ano.
 */
async function processAniversario(
  clinic: Awaited<ReturnType<typeof getClinicSettings>>,
  flow: FlowRecord | null,
  now: Date
): Promise<number> {
  if (!flow) return 0
  const msg = firstFlowMessage(flow, defaultAutomationMessage("aniversario"))

  const month = now.getMonth() + 1
  const day = now.getDate()
  const yearStart = new Date(now.getFullYear(), 0, 1)

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
        clinica: clinic.name,
      }),
      now
    )
    queued++
  }

  return queued
}

/**
 * 5) Reativação: clientes (com consulta REALIZADA) cuja última consulta
 *    aconteceu há mais de config.days dias, sem mensagem no período.
 */
async function processReativacao(
  clinic: Awaited<ReturnType<typeof getClinicSettings>>,
  flow: FlowRecord | null,
  now: Date
): Promise<number> {
  if (!flow) return 0
  const msg = firstFlowMessage(flow, defaultAutomationMessage("reativacao"))
  const days = gatilhoConfigNumber(flow, "days") ?? 60
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
        clinica: clinic.name,
      }),
      now
    )
    queued++
  }

  return queued
}

/**
 * 6) Pagamentos pendentes: lembrete (uma única vez por cobrança) para quem
 *    recebeu cobrança avulsa e não pagou dentro de config.delayMinutes.
 */
async function processPagamentosPendentes(
  clinic: Awaited<ReturnType<typeof getClinicSettings>>,
  flow: FlowRecord | null,
  now: Date
): Promise<number> {
  if (!flow) return 0
  const msg = firstFlowMessage(flow, defaultAutomationMessage("lembretepagamento"))
  const delayMinutes = gatilhoConfigNumber(flow, "delayMinutes") ?? 60
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

  let queued = 0
  for (const payment of payments) {
    const patientId = payment.patientId
    if (!patientId) continue

    const patient = await prisma.patient.findUnique({ where: { id: patientId } })
    if (!patient?.phone || !patient.whatsappEnabled || !patient.lgpdConsent) {
      continue
    }

    const link = paymentPageUrl(payment.id)
    // Bot pausado: enqueueMessage retorna null e o lembrete não é marcado
    // como enviado — reaparece no próximo cron, quando o bot voltar.
    const queuedMessage = await enqueueMessage(
      patientId,
      "LEMBRETE_PAGAMENTO",
      renderTemplate(msg, {
        nome: patient.name.split(" ")[0],
        valor: Number(payment.amount).toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
        }),
        link,
        clinica: clinic.name,
      }),
      now
    )
    if (!queuedMessage) continue
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
  // Retomada automática: apaga pausas cujo prazo já venceu.
  await sweepExpiredBotPauses(now)

  const clinic = await getClinicSettings()
  const [cadastroFlow, whatsappFlow, tratamentoFlow, aniversarioFlow, reativacaoFlow, pagamentosFlow] =
    await Promise.all([
      getFlowByGatilho("cadastro_incompleto"),
      getFlowByGatilho("whatsapp_contato"),
      getFlowByGatilho("tratamento_periodico"),
      getFlowByGatilho("aniversario"),
      getFlowByGatilho("reativacao"),
      getFlowByGatilho("lembrete_pagamento"),
    ])

  const cadastro = await processCadastroIncompleto(clinic, cadastroFlow, now)
  const whatsapp = await processWhatsAppContacts(clinic, whatsappFlow, now)
  const tratamento = await processTratamentoPeriodico(clinic, tratamentoFlow, now)
  const aniversario = await processAniversario(clinic, aniversarioFlow, now)
  const reativacao = await processReativacao(clinic, reativacaoFlow, now)
  const pagamentos = await processPagamentosPendentes(clinic, pagamentosFlow, now)

  return { cadastro, whatsapp, tratamento, aniversario, reativacao, pagamentos }
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
  const flow = await getFlowByGatilho("link_pagamento")
  if (!flow) return

  const clinic = await getClinicSettings()
  const patient = await prisma.patient.findUnique({ where: { id: patientId } })
  if (!patient?.phone || !patient.whatsappEnabled || !patient.lgpdConsent) return

  const msg = firstFlowMessage(flow, defaultAutomationMessage("linkpagamento"))
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
      clinica: clinic.name,
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
  const flow = await getFlowByGatilho("agradecimento")
  if (!flow) return false

  const clinic = await getClinicSettings()
  const patient = await prisma.patient.findUnique({ where: { id: patientId } })
  if (!patient?.phone || !patient.whatsappEnabled || !patient.lgpdConsent) {
    return false
  }

  const msg = firstFlowMessage(flow, defaultAutomationMessage("agradecimento"))

  await enqueueMessage(
    patientId,
    "AGRADECIMENTO",
    renderTemplate(msg, {
      nome: patient.name.split(" ")[0],
      data: new Date().toLocaleDateString("pt-BR"),
      clinica: clinic.name,
    }),
    new Date()
  )
  return true
}
