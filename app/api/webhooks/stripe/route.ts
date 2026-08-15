/**
 * Webhook do Stripe: confirma pagamentos com cartão/Apple Pay e baixa o
 * lançamento sozinho. A assinatura é validada com o webhook secret
 * configurado em Configurações → Pagamentos.
 * URL para configurar no Dashboard do Stripe: /api/webhooks/stripe
 * (Evento: checkout.session.completed)
 */
import { NextRequest, NextResponse } from "next/server"
import { getPaymentSettings } from "@/lib/payments/settings"
import { parseStripeWebhook } from "@/lib/payments/stripe"
import { processPaymentWebhook } from "@/lib/payments/router"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const settings = await getPaymentSettings()
  if (!settings.stripeWebhookSecret) {
    return NextResponse.json(
      { error: "Webhook secret não configurado" },
      { status: 500 }
    )
  }

  const rawBody = await request.text()
  const signature = request.headers.get("stripe-signature")

  const parsed = parseStripeWebhook(
    rawBody,
    signature,
    settings.stripeWebhookSecret
  )
  if (!parsed) {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 400 })
  }

  await processPaymentWebhook("STRIPE", parsed.event, parsed.eventId, null)

  return NextResponse.json({ ok: true, received: true })
}
