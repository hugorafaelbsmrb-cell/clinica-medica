/**
 * Webhook do Asaas: confirma pagamentos PIX e baixa o lançamento sozinho.
 * URL para configurar no painel do Asaas: /api/webhooks/asaas
 * (Eventos: PAYMENT_RECEIVED, PAYMENT_CONFIRMED, PAYMENT_OVERDUE, ...)
 */
import { NextRequest, NextResponse } from "next/server"
import { parseAsaasWebhook } from "@/lib/payments/asaas"
import { processPaymentWebhook } from "@/lib/payments/router"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 })
  }

  const parsed = parseAsaasWebhook(payload)
  if (!parsed) {
    // Sem id de pagamento no corpo — pode ser um teste do painel do Asaas.
    return NextResponse.json({ ok: true, received: false })
  }

  await processPaymentWebhook("ASAAS", parsed.event, parsed.eventId, payload)

  return NextResponse.json({ ok: true, received: true })
}
