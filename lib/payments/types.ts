/**
 * Tipos compartilhados da camada de pagamentos multi-gateway.
 *
 * Rotas por meio de pagamento (transparente para o usuário):
 *   PIX        → Asaas (liberado na hora, 0,99% por cobrança)
 *   CARTAO     → Stripe (3,99% + R$0,39, com Apple Pay/Google Pay no checkout)
 *   APPLE_PAY  → Stripe
 */
export type PaymentProviderType = "ASAAS" | "STRIPE" | "MOCK"
export type PaymentMethodType = "PIX" | "CARTAO" | "APPLE_PAY"

export type CreateChargeInput = {
  provider: PaymentProviderType
  method: PaymentMethodType
  /** Valor em centavos (R$ 100,00 = 10000). */
  amountCents: number
  description: string
  customerName?: string
  customerCpf?: string
}

export type CreateChargeResult = {
  ok: boolean
  providerPaymentId?: string
  checkoutUrl?: string
  pixCopiaCola?: string
  pixQrCodeUrl?: string
  externalStatus?: string
  error?: string
  /** true quando a cobrança foi criada em modo teste (gateway sem chave). */
  mock?: boolean
}

/** Evento normalizado de webhook — os dois gateways viram o mesmo formato. */
export type NormalizedPaymentEvent =
  | { type: "PAID"; providerPaymentId: string; paidAt: Date }
  | { type: "EXPIRED"; providerPaymentId: string }
  | { type: "CANCELLED"; providerPaymentId: string }
  | { type: "UNKNOWN" }

export type ProviderStatusResult = {
  ok: boolean
  /** Status interno mapeado a partir do status bruto do gateway. */
  status?: "PAGO" | "PENDENTE" | "EXPIRADO" | "CANCELADO" | "FALHOU"
  externalStatus?: string
  paidAt?: Date
  error?: string
}
