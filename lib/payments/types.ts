/**
 * Tipos compartilhados da camada de pagamentos multi-gateway.
 *
 * Rotas por meio de pagamento (transparente para o usuário):
 *   PIX        → Asaas (liberado na hora, 0,99% por cobrança)
 *   CARTAO     → Asaas (link de pagamento com checkout do cartão)
 *   APPLE_PAY  → Stripe (checkout hospedado; só a carteira Apple por enquanto)
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
  /** Parcelamento no cartão (Tabela Price): nº de parcelas e valor de cada. */
  installments?: number
  installmentValue?: number
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
  | { type: "REFUNDED"; providerPaymentId: string }
  | { type: "UNKNOWN" }

export type ProviderStatusResult = {
  ok: boolean
  /** Status interno mapeado a partir do status bruto do gateway. */
  status?: "PAGO" | "PENDENTE" | "EXPIRADO" | "CANCELADO" | "FALHOU" | "REFUNDED"
  externalStatus?: string
  paidAt?: Date
  error?: string
}
