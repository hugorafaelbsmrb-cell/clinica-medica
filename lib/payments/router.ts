/**
 * Roteador de pagamentos — camada única por onde passam todas as cobranças.
 *
 * Decide o gateway pelo meio de pagamento (transparente para o usuário):
 *   PIX       → Asaas   (copia-e-cola + QR code)
 *   CARTAO    → Stripe  (checkout hospedado; Apple Pay/Google Pay aparecem)
 *   APPLE_PAY → Stripe
 *
 * Também concentra a baixa automática: qualquer webhook confirmado dos dois
 * gateways é normalizado aqui e baixa o lançamento do Financeiro sozinho.
 */
import { prisma } from "@/lib/prisma"
import { getPaymentSettings } from "@/lib/payments/settings"
import { createAsaasCharge, getAsaasPaymentStatus } from "@/lib/payments/asaas"
import {
  createStripeCheckout,
  getStripeCheckoutStatus,
} from "@/lib/payments/stripe"
import type {
  CreateChargeInput,
  CreateChargeResult,
  PaymentMethodType,
  PaymentProviderType,
  NormalizedPaymentEvent,
  ProviderStatusResult,
} from "@/lib/payments/types"

/** Qual gateway atende cada meio de pagamento. */
export function providerForMethod(method: PaymentMethodType): PaymentProviderType {
  return method === "PIX" ? "ASAAS" : "STRIPE"
}

/** Cria a cobrança no gateway certo e registra no banco. */
export async function createCharge(
  input: Omit<CreateChargeInput, "provider"> & {
    method: PaymentMethodType
    financialEntryId?: string
  }
): Promise<
  CreateChargeResult & { paymentId?: string; provider?: PaymentProviderType }
> {
  const provider = providerForMethod(input.method)
  const settings = await getPaymentSettings()

  // Gateway sem chave configurada → não deixa criar cobrança "fantasma".
  const missing =
    provider === "ASAAS" ? !settings.asaasApiKey : !settings.stripeSecretKey
  if (missing) {
    return {
      ok: false,
      error:
        provider === "ASAAS"
          ? "Chave do Asaas não configurada — configure em Configurações → Pagamentos"
          : "Chave do Stripe não configurada — configure em Configurações → Pagamentos",
    }
  }

  const payment = await prisma.payment.create({
    data: {
      provider,
      method: input.method,
      amount: Number((input.amountCents / 100).toFixed(2)),
      status: "PENDENTE",
      financialEntryId: input.financialEntryId ?? null,
    },
  })

  const fullInput: CreateChargeInput = {
    provider,
    method: input.method,
    amountCents: input.amountCents,
    description: input.description,
    customerName: input.customerName,
    customerCpf: input.customerCpf,
  }

  const result =
    provider === "ASAAS"
      ? await createAsaasCharge(fullInput, settings.asaasApiKey)
      : await createStripeCheckout(fullInput, settings.stripeSecretKey)

  if (!result.ok) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "FALHOU", externalStatus: result.error?.slice(0, 200) },
    })
    return { ...result, paymentId: payment.id, provider }
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      providerPaymentId: result.providerPaymentId,
      checkoutUrl: result.checkoutUrl,
      pixCopiaCola: result.pixCopiaCola,
      pixQrCodeUrl: result.pixQrCodeUrl,
      externalStatus: result.externalStatus,
    },
  })

  return { ...result, paymentId: payment.id, provider }
}

/** Consulta o status no gateway e aplica a baixa se o pagamento caiu. */
export async function refreshPaymentStatus(
  paymentId: string
): Promise<{ success: boolean; message: string; status?: string }> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (!payment) return { success: false, message: "Cobrança não encontrada" }
  if (!payment.providerPaymentId) {
    return {
      success: false,
      message: "Cobrança sem id do gateway — gere o link novamente",
    }
  }

  const settings = await getPaymentSettings()
  const result: ProviderStatusResult =
    payment.provider === "ASAAS"
      ? await getAsaasPaymentStatus(payment.providerPaymentId, settings.asaasApiKey)
      : await getStripeCheckoutStatus(payment.providerPaymentId, settings.stripeSecretKey)

  if (!result.ok) {
    return {
      success: false,
      message: result.error ?? "Falha ao consultar o gateway",
    }
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { externalStatus: result.externalStatus },
  })

  if (result.status === "PAGO") {
    await applyPaymentPaid(payment.id, result.paidAt ?? new Date())
    return { success: true, message: "Pagamento confirmado — lançamento baixado", status: "PAGO" }
  }
  if (result.status === "EXPIRADO") {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "EXPIRADO" },
    })
    return { success: true, message: "Cobrança expirada — gere um novo link", status: "EXPIRADO" }
  }
  return {
    success: true,
    message: "Ainda não confirmado no gateway",
    status: "PENDENTE",
  }
}

/**
 * Processa um evento de webhook normalizado (Asaas ou Stripe) com
 * idempotência: eventos duplicados são ignorados pelo id único do provedor.
 */
export async function processPaymentWebhook(
  provider: PaymentProviderType,
  event: NormalizedPaymentEvent,
  eventId: string,
  raw: unknown
): Promise<void> {
  const existing = await prisma.paymentWebhookEvent.findUnique({
    where: { provider_eventId: { provider, eventId } },
  })
  if (existing) return // já processado — provedores reenviam eventos

  await prisma.paymentWebhookEvent.create({
    data: {
      provider,
      eventId,
      raw: raw as object,
    },
  })

  if (event.type === "UNKNOWN" || !event.providerPaymentId) return

  const payment = await prisma.payment.findFirst({
    where: { provider, providerPaymentId: event.providerPaymentId },
  })
  if (!payment) return // cobrança não pertence a este sistema

  switch (event.type) {
    case "PAID":
      await applyPaymentPaid(payment.id, event.paidAt)
      break
    case "EXPIRED":
      if (payment.status === "PENDENTE") {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: "EXPIRADO" },
        })
      }
      break
    case "CANCELLED":
      if (payment.status === "PENDENTE") {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: "CANCELADO" },
        })
      }
      break
  }
}

/**
 * Baixa automática: marca a cobrança como paga e, se houver lançamento
 * financeiro vinculado, o lançamento vira PAGO sozinho (sem conciliação manual).
 */
async function applyPaymentPaid(paymentId: string, paidAt: Date): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (!payment) return

  const methodLabel: Record<PaymentMethodType, string> = {
    PIX: "PIX",
    CARTAO: "CARTAO",
    APPLE_PAY: "APPLE_PAY",
  }

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: "PAGO", paidAt },
    }),
    ...(payment.financialEntryId
      ? [
          prisma.financialEntry.update({
            where: { id: payment.financialEntryId },
            data: {
              status: "PAGO",
              paymentMethod: methodLabel[payment.method],
            },
          }),
        ]
      : []),
  ])

  await prisma.auditLog.create({
    data: {
      action: "PAYMENT_RECEIVED",
      entity: "Payment",
      entityId: payment.id,
      details: {
        provider: payment.provider,
        method: payment.method,
        amount: Number(payment.amount),
        financialEntryId: payment.financialEntryId,
      },
    },
  })
}
