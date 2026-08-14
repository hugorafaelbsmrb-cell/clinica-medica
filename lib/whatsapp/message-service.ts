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
import { getWhatsAppProvider, normalizePhone } from "./provider"

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

export async function enqueueMessage(
  patientId: string,
  type:
    | "PRIMEIRO_CONTATO"
    | "ACOMPANHAMENTO"
    | "MANUAL"
    | "CONFIRMACAO_AGENDAMENTO"
    | "LEMBRETE_CONSULTA"
    | "TRATAMENTO_PERIODICO"
    | "ANIVERSARIO"
    | "REATIVACAO"
    | "AGRADECIMENTO",
  content: string,
  scheduledFor?: Date,
  attendanceId?: string
) {
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
 * Primeiro contato: chamado ao cadastrar um paciente com WhatsApp habilitado.
 * Usa o template "Primeiro contato" se existir, senão um texto padrão.
 */
export async function queueFirstContact(patientId: string): Promise<void> {
  const patient = await prisma.patient.findUnique({ where: { id: patientId } })
  if (!patient?.phone || !patient.whatsappEnabled) return

  const template = await prisma.messageTemplate.findFirst({
    where: { type: "PRIMEIRO_CONTATO", active: true },
  })

  const content = template
    ? renderTemplate(template.body, {
        nome: patient.name.split(" ")[0],
        data: format(new Date(), "dd/MM/yyyy", { locale: ptBR }),
      })
    : `Olá ${patient.name.split(" ")[0]}! Aqui é da Clínica Médica. Que bom ter você com a gente!`

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
  return { ok: true, message: "Mensagem enfileirada para envio" }
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
      patient: { whatsappEnabled: true, phone: { not: null } },
    },
    include: { patient: true },
  })

  const template = await prisma.messageTemplate.findFirst({
    where: { type: "ACOMPANHAMENTO", active: true },
  })

  let queued = 0
  for (const config of due) {
    const content = template
      ? renderTemplate(template.body, {
          nome: config.patient.name.split(" ")[0],
          data: format(now, "dd/MM/yyyy", { locale: ptBR }),
        })
      : `Olá ${config.patient.name.split(" ")[0]}, tudo bem? Como está a sua saúde?`

    await enqueueMessage(config.patientId, "ACOMPANHAMENTO", content, now)

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
 * Confirmação de agendamento: enfileira a mensagem com os dados da consulta
 * e o link público de cancelamento.
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

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  const cancelLink = `${baseUrl}/cancelar/${attendance.cancelToken ?? ""}`

  const content = template
    ? renderTemplate(template.body, {
        nome: patient.name.split(" ")[0],
        data: format(attendance.scheduledAt, "dd/MM/yyyy", { locale: ptBR }),
        hora: format(attendance.scheduledAt, "HH:mm", { locale: ptBR }),
        link: cancelLink,
      })
    : `Olá ${patient.name.split(" ")[0]}! Sua consulta está confirmada para ${format(
        attendance.scheduledAt,
        "dd/MM/yyyy",
        { locale: ptBR }
      )} às ${format(attendance.scheduledAt, "HH:mm", { locale: ptBR })}. Se precisar cancelar, acesse: ${cancelLink}`

  await enqueueMessage(patientId, "CONFIRMACAO_AGENDAMENTO", content, new Date(), attendance.id)
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
      patient: { whatsappEnabled: true, phone: { not: null } },
    },
    include: { patient: true },
  })

  const template = await prisma.messageTemplate.findFirst({
    where: { type: "LEMBRETE_CONSULTA", active: true },
  })

  let queued = 0
  for (const attendance of attendances) {
    // Evita duplicar lembrete para a mesma consulta
    const existing = await prisma.message.findFirst({
      where: { type: "LEMBRETE_CONSULTA", attendanceId: attendance.id },
    })
    if (existing) continue

    const content = template
      ? renderTemplate(template.body, {
          nome: attendance.patient.name.split(" ")[0],
          data: format(attendance.scheduledAt, "dd/MM/yyyy", { locale: ptBR }),
          hora: format(attendance.scheduledAt, "HH:mm", { locale: ptBR }),
        })
      : `Olá ${attendance.patient.name.split(" ")[0]}! Lembrete: sua consulta é amanhã, ${format(
          attendance.scheduledAt,
          "dd/MM/yyyy",
          { locale: ptBR }
        )} às ${format(attendance.scheduledAt, "HH:mm", { locale: ptBR })}.`

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
    take: 100,
  })

  let sent = 0
  let failed = 0

  for (const message of pending) {
    if (!message.patient.phone) {
      await prisma.message.update({
        where: { id: message.id },
        data: { status: "FALHA", error: "Paciente sem telefone" },
      })
      failed++
      continue
    }

    const result = await provider.sendText(
      normalizePhone(message.patient.phone),
      message.content
    )

    if (result.ok) {
      await prisma.message.update({
        where: { id: message.id },
        data: { status: "ENVIADA", sentAt: now, error: null },
      })
      sent++
    } else {
      await prisma.message.update({
        where: { id: message.id },
        data: { status: "FALHA", error: result.error ?? "Erro desconhecido" },
      })
      failed++
    }
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
  const patient = await prisma.patient.findFirst({
    where: { phone: { contains: normalized.slice(2) } },
  })

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
