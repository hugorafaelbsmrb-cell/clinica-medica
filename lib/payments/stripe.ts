/**
 * Provedor Stripe — cobranças Apple Pay.
 *
 * Usa o Checkout hospedado do Stripe: com o meio "card" habilitado, o
 * Apple Pay aparece automaticamente nos aparelhos compatíveis — o Stripe
 * gerencia os certificados da Apple, sem trabalho extra para o lojista.
 * Por enquanto só o Apple Pay passa por aqui (PIX e cartão ficam no Asaas).
 * Documentação: https://docs.stripe.com/payments/checkout
 */
import Stripe from "stripe"
import type {
  CreateChargeInput,
  CreateChargeResult,
  NormalizedPaymentEvent,
  ProviderStatusResult,
} from "@/lib/payments/types"

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://painel.medicoemdomicilio.com"

function client(secretKey: string): Stripe {
  return new Stripe(secretKey)
}

/** Cria um Checkout Session para Apple Pay (carteira aparece sozinha). */
export async function createStripeCheckout(
  input: CreateChargeInput,
  secretKey: string
): Promise<CreateChargeResult> {
  if (input.method !== "APPLE_PAY") {
    return { ok: false, error: "Só o Apple Pay é cobrado pelo Stripe por enquanto" }
  }

  try {
    const stripe = client(secretKey)
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "brl",
            unit_amount: input.amountCents,
            product_data: { name: input.description.slice(0, 300) },
          },
        },
      ],
      // Com "card" habilitado, o Apple Pay aparece sozinho no checkout
      // em aparelhos compatíveis.
      payment_method_types: ["card"],
      success_url: `${APP_URL}/pagamento/status?r=ok`,
      cancel_url: `${APP_URL}/pagamento/status?r=cancel`,
    })

    return {
      ok: true,
      providerPaymentId: session.id,
      checkoutUrl: session.url ?? undefined,
      externalStatus: session.payment_status,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Stripe respondeu um erro`
    return { ok: false, error: message }
  }
}

/** Consulta o status de um Checkout Session no Stripe. */
export async function getStripeCheckoutStatus(
  providerPaymentId: string,
  secretKey: string
): Promise<ProviderStatusResult> {
  try {
    const stripe = client(secretKey)
    const session = await stripe.checkout.sessions.retrieve(providerPaymentId)

    if (session.payment_status === "paid") {
      return {
        ok: true,
        status: "PAGO",
        externalStatus: session.payment_status,
        paidAt: new Date(),
      }
    }
    if (session.status === "expired") {
      return { ok: true, status: "EXPIRADO", externalStatus: "expired" }
    }
    return {
      ok: true,
      status: "PENDENTE",
      externalStatus: session.payment_status ?? session.status,
    }
  } catch {
    return {
      ok: false,
      error: "Falha ao consultar o pagamento no Stripe.",
    }
  }
}

/**
 * Valida a assinatura do webhook do Stripe e converte o evento no formato
 * normalizado. Retorna null quando a assinatura é inválida (payload suspeito).
 */
export function parseStripeWebhook(
  rawBody: string,
  signature: string | null,
  webhookSecret: string
): { event: NormalizedPaymentEvent; eventId: string } | null {
  try {
    const stripe = client("sk_dummy") // constructEvent não usa a chave
    const stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      signature ?? "",
      webhookSecret
    )

    let event: NormalizedPaymentEvent = { type: "UNKNOWN" }
    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object as Stripe.Checkout.Session
      if (session.payment_status === "paid") {
        event = {
          type: "PAID",
          providerPaymentId: session.id,
          paidAt: new Date(),
        }
      }
    } else if (stripeEvent.type === "checkout.session.expired") {
      const session = stripeEvent.data.object as Stripe.Checkout.Session
      event = { type: "EXPIRED", providerPaymentId: session.id }
    }

    return { event, eventId: stripeEvent.id }
  } catch {
    return null
  }
}

/** Testa a chave secreta consultando o saldo da conta. */
export async function testStripeConnection(
  secretKey: string
): Promise<{ success: boolean; message: string }> {
  try {
    const stripe = client(secretKey)
    await stripe.balance.retrieve()
    return { success: true, message: "Chave válida — conexão com o Stripe OK" }
  } catch (error) {
    const stripeError = error as { type?: string; code?: string }
    if (
      stripeError.type === "StripeAuthenticationError" ||
      stripeError.code === "api_key_invalid"
    ) {
      return {
        success: false,
        message: "Chave inválida — o Stripe recusou a autenticação",
      }
    }
    return {
      success: false,
      message:
        error instanceof Error
          ? `Falha ao conectar no Stripe: ${error.message}`
          : "Falha ao conectar no Stripe.",
    }
  }
}
