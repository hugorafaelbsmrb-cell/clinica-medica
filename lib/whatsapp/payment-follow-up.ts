/**
 * Follow-up do agendamento online não pago.
 *
 * Reservas com cobrança (status AGUARDANDO_PAGAMENTO) recebem lembretes
 * automáticos definidos pelo fluxo de automação `agendamento_followup`
 * (por padrão 30 minutos, 1 hora e 2 horas após a reserva — a cadeia de
 * MENSAGEMs e os atrasos das arestas vêm do grafo). Sem confirmação de
 * pagamento depois do último lembrete, o sistema confere o gateway, cancela
 * a reserva, libera o horário na agenda e orienta o paciente a fazer um novo
 * agendamento (texto do fluxo `agendamento_cancelado`).
 *
 * Módulo separado (fora de flow-automations.ts) de propósito: o router de
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
import {
  firstFlowMessage,
  getFlowByGatilho,
} from "./flow-automations"
import { flowMessageChain } from "./flow-types"
import { enqueueMessage, renderTemplate } from "./message-service"

export type AgendamentoFollowUpCounts = {
  /** Lembretes enfileirados nesta execução. */
  lembretes: number
  /** Reservas canceladas por falta de pagamento. */
  cancelados: number
}

/** Template padrão do lembrete (usado no seed — quando o nó fica vazio). */
export function defaultFollowUpMessage(): string {
  return "Olá {{nome}}! 😊 Seu horário continua reservado. Para confirmar a consulta, falta o pagamento de R$ {{valor}} — é rapidinho por aqui: {{link}}"
}

/** Template padrão do aviso de liberação (usado no seed — nó vazio). */
export function defaultCanceladoMessage(): string {
  return "Olá {{nome}}! 😔 Como não identificamos o pagamento da sua consulta de {{data}} às {{hora}}, a reserva foi liberada. Não se preocupe: é só agendar de novo por aqui: {{link}}"
}

/**
 * Processa o follow-up de agendamentos online com cobrança pendente.
 * Chamado pelo cron a cada 10 minutos. Se o fluxo `agendamento_followup`
 * não existir ou estiver desligado, nada é enviado.
 */
export async function processAgendamentoFollowUps(
  now = new Date()
): Promise<AgendamentoFollowUpCounts> {
  const flow = await getFlowByGatilho("agendamento_followup")
  if (!flow) return { lembretes: 0, cancelados: 0 }

  const chain = flowMessageChain(flow)
  const total = chain.length
  if (total === 0) return { lembretes: 0, cancelados: 0 }

  const clinic = await getClinicSettings()

  const payments = await prisma.payment.findMany({
    where: {
      status: "PENDENTE",
      attendanceId: { not: null },
      followUpStage: { lte: total },
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
        data: { followUpStage: total + 1 },
      })
      continue
    }

    const ageMinutes = (now.getTime() - payment.createdAt.getTime()) / 60000
    const stage = payment.followUpStage

    // Todos os lembretes enviados e o último marco vencido: confere o
    // gateway antes de cancelar — o webhook pode ter atrasado. Sem
    // pagamento, cancela a reserva, libera o horário e orienta o paciente
    // a agendar novamente (texto do fluxo `agendamento_cancelado`).
    if (stage >= total && ageMinutes >= chain[total - 1].dueMinutes) {
      let paid = false
      if (payment.provider !== "MOCK" && payment.providerPaymentId) {
        const check = await refreshPaymentStatus(payment.id)
        paid = check.status === "PAGO" || check.status === "REFUNDED"
      }
      if (paid) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { followUpStage: total + 1 },
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
        data: { followUpStage: total + 1 },
      })

      const cancelFlow = await getFlowByGatilho("agendamento_cancelado")
      const msgCancelado = cancelFlow
        ? firstFlowMessage(cancelFlow, defaultCanceladoMessage())
        : defaultCanceladoMessage()

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

    // Lembretes por estágio — o próximo índice devido é o mais alto cujo
    // marco passou (se o cron perdeu execuções, o anterior é pulado);
    // no máximo um avanço por execução.
    let nextIdx: number | null = null
    for (let i = total - 1; i >= 0; i--) {
      if (stage <= i && ageMinutes >= chain[i].dueMinutes) {
        nextIdx = i
        break
      }
    }
    if (nextIdx === null) continue

    const patient = await prisma.patient.findUnique({
      where: { id: attendance.patientId },
    })
    if (patient?.phone && patient.whatsappEnabled && patient.lgpdConsent) {
      // Bot pausado: enqueueMessage retorna null e o estágio não avança —
      // o lembrete reaparece no próximo cron, quando o bot voltar.
      const queued = await enqueueMessage(
        attendance.patientId,
        "LEMBRETE_PAGAMENTO",
        renderTemplate(chain[nextIdx].node.content || defaultFollowUpMessage(), {
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
      data: { followUpStage: nextIdx + 1, remindedAt: now },
    })
    lembretes++
  }

  return { lembretes, cancelados }
}
