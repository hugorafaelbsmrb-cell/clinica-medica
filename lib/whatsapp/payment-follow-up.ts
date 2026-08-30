/**
 * Follow-up do agendamento online não pago.
 *
 * Reservas com cobrança (status AGUARDANDO_PAGAMENTO) recebem lembretes
 * automáticos em 30 minutos, 1 hora e 2 horas após a reserva. Sem
 * confirmação de pagamento depois do último lembrete, o sistema confere o
 * gateway, cancela a reserva, libera o horário na agenda e orienta o
 * paciente a fazer um novo agendamento.
 *
 * Módulo separado (fora de automations.ts) de propósito: o router de
 * pagamentos importa as automações e este módulo importa o router —
 * mantê-lo aqui evita import circular.
 */
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { prisma } from "@/lib/prisma"
import { getClinicSettings } from "@/lib/clinic"
import { cancelPendingPaymentAndEntry } from "@/lib/payments/cancellation"
import { paymentPageUrl } from "@/lib/payments/url"
import {
  refreshPaymentStatus,
  releasePendingAttendance,
} from "@/lib/payments/router"
import { enqueueMessage, renderTemplate } from "./message-service"

export type AgendamentoFollowUpCounts = {
  /** Lembretes enfileirados nesta execução. */
  lembretes: number
  /** Reservas canceladas por falta de pagamento. */
  cancelados: number
}

/** Marcos do follow-up em minutos após a reserva (30 min, 1h e 2h). */
const STAGE_MINUTES = [30, 60, 120] as const

/** Template padrão do lembrete (quando o admin deixa vazio). */
function defaultFollowUpMessage(): string {
  return "Olá {{nome}}! 😊 Seu horário continua reservado. Para confirmar a consulta, falta o pagamento de R$ {{valor}} — é rapidinho por aqui: {{link}}"
}

/** Template padrão do aviso de liberação (quando o admin deixa vazio). */
function defaultCanceladoMessage(): string {
  return "Olá {{nome}}! 😔 Como não identificamos o pagamento da sua consulta de {{data}} às {{hora}}, a reserva foi liberada. Não se preocupe: é só agendar de novo por aqui: {{link}}"
}

/**
 * Processa o follow-up de agendamentos online com cobrança pendente.
 * Chamado pelo cron a cada 10 minutos.
 */
export async function processAgendamentoFollowUps(
  now = new Date()
): Promise<AgendamentoFollowUpCounts> {
  const clinic = await getClinicSettings()
  if (!clinic.autoAgendamentoFollowUpEnabled) {
    return { lembretes: 0, cancelados: 0 }
  }

  const payments = await prisma.payment.findMany({
    where: {
      status: "PENDENTE",
      attendanceId: { not: null },
      followUpStage: { lte: 3 },
    },
    include: {
      attendance: {
        select: { id: true, status: true, patientId: true, scheduledAt: true },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  })
  if (payments.length === 0) return { lembretes: 0, cancelados: 0 }

  const msgFollowUp =
    clinic.autoAgendamentoFollowUpMsg?.trim() || defaultFollowUpMessage()
  const msgCancelado =
    clinic.autoAgendamentoCanceladoMsg?.trim() || defaultCanceladoMessage()
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://painel.medicoemdomicilio.com"

  let lembretes = 0
  let cancelados = 0

  for (const payment of payments) {
    const attendance = payment.attendance

    // Reserva não está mais aguardando pagamento (cancelada manualmente,
    // horário liberado etc.): encerra a cobrança e o lançamento pendente.
    if (!attendance || attendance.status !== "AGUARDANDO_PAGAMENTO") {
      await cancelPendingPaymentAndEntry(
        payment.id,
        "Horário não está mais reservado"
      )
      await prisma.payment.update({
        where: { id: payment.id },
        data: { followUpStage: 4 },
      })
      continue
    }

    const ageMinutes = (now.getTime() - payment.createdAt.getTime()) / 60000
    const stage = payment.followUpStage

    // Estágio final (2h): confere o gateway antes de cancelar — o webhook
    // pode ter atrasado. Sem pagamento, cancela a reserva, libera o horário
    // e orienta o paciente a agendar novamente.
    if (stage === 3 && ageMinutes >= STAGE_MINUTES[2]) {
      let paid = false
      if (payment.provider !== "MOCK" && payment.providerPaymentId) {
        const check = await refreshPaymentStatus(payment.id)
        paid = check.status === "PAGO" || check.status === "REFUNDED"
      }
      if (paid) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { followUpStage: 4 },
        })
        continue
      }

      await cancelPendingPaymentAndEntry(
        payment.id,
        "Follow-up de agendamento: pagamento não identificado"
      )
      await releasePendingAttendance(attendance.id)
      await prisma.payment.update({
        where: { id: payment.id },
        data: { followUpStage: 4 },
      })

      const patient = await prisma.patient.findUnique({
        where: { id: attendance.patientId },
      })
      if (patient?.phone && patient.whatsappEnabled && patient.lgpdConsent) {
        await enqueueMessage(
          attendance.patientId,
          "AGENDAMENTO_CANCELADO",
          renderTemplate(msgCancelado, {
            nome: patient.name.split(" ")[0],
            data: format(attendance.scheduledAt, "dd/MM/yyyy", { locale: ptBR }),
            hora: format(attendance.scheduledAt, "HH:mm", { locale: ptBR }),
            link: `${baseUrl}/cadastro`,
            clinica: clinic.name,
          }),
          now
        )
      }
      cancelados++
      continue
    }

    // Lembretes por estágio — no máximo um avanço por execução do cron
    // (se o cron perdeu execuções, o lembrete anterior é pulado).
    let nextStage: number | null = null
    if (
      stage === 0 &&
      ageMinutes >= STAGE_MINUTES[0] &&
      ageMinutes < STAGE_MINUTES[1]
    ) {
      nextStage = 1
    } else if (
      stage <= 1 &&
      ageMinutes >= STAGE_MINUTES[1] &&
      ageMinutes < STAGE_MINUTES[2]
    ) {
      nextStage = 2
    } else if (stage <= 2 && ageMinutes >= STAGE_MINUTES[2]) {
      nextStage = 3
    }
    if (nextStage === null) continue

    const patient = await prisma.patient.findUnique({
      where: { id: attendance.patientId },
    })
    if (patient?.phone && patient.whatsappEnabled && patient.lgpdConsent) {
      // Bot pausado: enqueueMessage retorna null e o estágio não avança —
      // o lembrete reaparece no próximo cron, quando o bot voltar.
      const queued = await enqueueMessage(
        attendance.patientId,
        "LEMBRETE_PAGAMENTO",
        renderTemplate(msgFollowUp, {
          nome: patient.name.split(" ")[0],
          valor: Number(payment.amount).toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
          }),
          link: paymentPageUrl(payment.id),
          clinica: clinic.name,
        }),
        now
      )
      if (!queued) continue
    }
    await prisma.payment.update({
      where: { id: payment.id },
      data: { followUpStage: nextStage, remindedAt: now },
    })
    lembretes++
  }

  return { lembretes, cancelados }
}
