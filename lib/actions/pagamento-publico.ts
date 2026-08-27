"use server"

/**
 * Ações públicas de pagamento (sem sessão), usadas pela página /pagar/[id]:
 * o paciente paga a cobrança gerada pelo painel ou pelo agendamento online
 * direto no sistema — PIX (QR + copia-e-cola) e cartão de crédito
 * transparente — sem ser redirecionado para o site do gateway.
 * A identificação é o próprio id da cobrança (aleatório e não sequencial),
 * no mesmo padrão do cancelToken dos agendamentos.
 */
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getClientIp } from "@/lib/payments/ip"
import {
  payChargeWithCard,
  simulatePaymentPaid,
} from "@/lib/payments/router"

const pagarCartaoSchema = z.object({
  /** Id da cobrança (chave pública da página de pagamento). */
  token: z.string().min(1),
  holderName: z.string().trim().min(3, "Informe o nome impresso no cartão"),
  number: z.string().regex(/^\d{13,19}$/, "Número do cartão inválido"),
  expiryMonth: z.string().regex(/^(0[1-9]|1[0-2])$/, "Mês de validade inválido"),
  expiryYear: z.string().regex(/^\d{4}$/, "Ano de validade inválido"),
  ccv: z.string().regex(/^\d{3,4}$/, "CVV inválido"),
})

export type PagarCartaoState = {
  success: boolean
  message: string
  scheduledAt?: string
  /** true = pagamento em análise (ex.: antifraude); confirmação via webhook. */
  pending?: boolean
}

/** Paga a cobrança com cartão de crédito direto no sistema (transparente). */
export async function pagarComCartao(
  input: z.infer<typeof pagarCartaoSchema>
): Promise<PagarCartaoState> {
  const parsed = pagarCartaoSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados do cartão inválidos",
    }
  }

  const payment = await prisma.payment.findUnique({
    where: { id: parsed.data.token },
  })
  if (!payment) return { success: false, message: "Cobrança não encontrada" }
  if (payment.status !== "PENDENTE") {
    return { success: false, message: "Esta cobrança já foi finalizada" }
  }

  const remoteIp = await getClientIp()
  return payChargeWithCard(
    payment.id,
    {
      holderName: parsed.data.holderName,
      number: parsed.data.number,
      expiryMonth: parsed.data.expiryMonth,
      expiryYear: parsed.data.expiryYear,
      ccv: parsed.data.ccv,
    },
    remoteIp
  )
}

/**
 * Verificação pública do pagamento (sem sessão): a página consulta em loop
 * até o webhook confirmar e a cobrança virar PAGO.
 */
export async function verificarPagamentoPorToken(input: {
  token: string
}): Promise<{ pago: boolean; expirado?: boolean; scheduledAt?: string }> {
  const payment = await prisma.payment.findUnique({
    where: { id: input.token },
    include: {
      attendance: { select: { scheduledAt: true } },
    },
  })
  if (!payment) return { pago: false }

  if (payment.status === "PAGO") {
    return {
      pago: true,
      scheduledAt: payment.attendance?.scheduledAt.toISOString(),
    }
  }
  if (
    payment.status === "EXPIRADO" ||
    payment.status === "CANCELADO" ||
    payment.status === "FALHOU"
  ) {
    return { pago: false, expirado: true }
  }
  return { pago: false }
}

/**
 * Simula a aprovação de uma cobrança em modo teste (MOCK) pela página
 * pública — mesmo caminho de baixa de um webhook real.
 */
export async function simularPagamentoPorToken(input: {
  token: string
}): Promise<{ success: boolean; message: string; scheduledAt?: string }> {
  const payment = await prisma.payment.findUnique({
    where: { id: input.token },
    include: {
      attendance: {
        select: { id: true, cancelToken: true },
      },
    },
  })
  if (!payment) return { success: false, message: "Cobrança não encontrada" }

  return simulatePaymentPaid(
    payment.id,
    payment.attendanceId
      ? {
          attendanceId: payment.attendanceId,
          token: payment.attendance?.cancelToken ?? "",
        }
      : undefined
  )
}
