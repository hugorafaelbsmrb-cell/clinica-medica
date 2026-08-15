/**
 * Provedor Asaas — cobranças PIX e cartão de crédito.
 *
 * API REST simples (https://api.asaas.com/v3) com autenticação pelo header
 * `access_token`. Não precisa de SDK: usamos fetch direto.
 *
 * Meios de pagamento:
 *  - PIX: QR code + copia-e-cola já vêm na resposta;
 *  - cartão: o Asaas devolve o link de pagamento (invoiceUrl) com o
 *    checkout do cartão hospedado por ele.
 * Documentação: https://docs.asaas.com/reference/api-de-pagamentos
 */
import type {
  CreateChargeInput,
  CreateChargeResult,
  NormalizedPaymentEvent,
  ProviderStatusResult,
} from "@/lib/payments/types"

const BASE_URL = "https://api.asaas.com/v3"

type AsaasPayment = {
  id: string
  status: string
  value?: number
  invoiceUrl?: string
  pixQrCodeUrl?: string
  payload?: string
  paymentDate?: string
}

function headers(apiKey: string): Record<string, string> {
  return {
    access_token: apiKey,
    "Content-Type": "application/json",
  }
}

/**
 * Cria uma cobrança no Asaas.
 * PIX → QR code + copia-e-cola na resposta; cartão → link de pagamento.
 */
export async function createAsaasCharge(
  input: CreateChargeInput,
  apiKey: string
): Promise<CreateChargeResult> {
  if (input.method === "APPLE_PAY") {
    return { ok: false, error: "Apple Pay não é cobrado pelo Asaas" }
  }

  try {
    const today = new Date()
    const dueDate = today.toISOString().slice(0, 10) // vence hoje (23:59)

    const body: Record<string, unknown> = {
      billingType: input.method === "CARTAO" ? "CREDIT_CARD" : "PIX",
      value: Number((input.amountCents / 100).toFixed(2)),
      dueDate,
      description: input.description.slice(0, 500),
      externalReference: `clinica-medica`,
    }
    if (input.customerName) {
      body.customer = {
        name: input.customerName.slice(0, 255),
        ...(input.customerCpf
          ? { cpfCnpj: input.customerCpf.replace(/\D/g, "") }
          : {}),
      }
    }

    const response = await fetch(`${BASE_URL}/payments`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify(body),
    })
    const data = (await response.json().catch(() => ({}))) as AsaasPayment & {
      errors?: { description?: string }[]
    }

    if (!response.ok || !data.id) {
      const detail =
        data.errors?.[0]?.description ?? `Asaas respondeu ${response.status}`
      return { ok: false, error: detail }
    }

    return {
      ok: true,
      providerPaymentId: data.id,
      checkoutUrl: data.invoiceUrl,
      pixCopiaCola: data.payload,
      pixQrCodeUrl: data.pixQrCodeUrl,
      externalStatus: data.status,
    }
  } catch {
    return {
      ok: false,
      error: "Falha ao conectar no Asaas. Verifique a conexão e a chave.",
    }
  }
}

/** Consulta o status de um pagamento no Asaas. */
export async function getAsaasPaymentStatus(
  providerPaymentId: string,
  apiKey: string
): Promise<ProviderStatusResult> {
  try {
    const response = await fetch(`${BASE_URL}/payments/${providerPaymentId}`, {
      method: "GET",
      headers: headers(apiKey),
    })
    const data = (await response.json().catch(() => ({}))) as AsaasPayment

    if (!response.ok || !data.id) {
      return {
        ok: false,
        error: `Asaas respondeu ${response.status} ao consultar o pagamento`,
      }
    }

    return { ok: true, ...mapAsaasStatus(data.status, data.paymentDate) }
  } catch {
    return {
      ok: false,
      error: "Falha ao conectar no Asaas ao consultar o pagamento.",
    }
  }
}

/**
 * Converte o webhook do Asaas no formato normalizado.
 * Eventos: PAYMENT_RECEIVED/CONFIRMED (pago), PAYMENT_OVERDUE (vencido),
 * PAYMENT_DELETED (cancelado). O resto é ignorado (UNKNOWN).
 */
export function parseAsaasWebhook(
  payload: unknown
): { event: NormalizedPaymentEvent; eventId: string } | null {
  const body = payload as {
    event?: string
    id?: string
    payment?: { id?: string; paymentDate?: string }
  }
  const eventName = body.event ?? ""
  const paymentId = body.payment?.id
  const eventId =
    body.id ?? `evt_${eventName}_${paymentId ?? Math.random().toString(36).slice(2)}`
  if (!paymentId) return null

  let event: NormalizedPaymentEvent
  if (eventName === "PAYMENT_RECEIVED" || eventName === "PAYMENT_CONFIRMED") {
    event = {
      type: "PAID",
      providerPaymentId: paymentId,
      paidAt: body.payment?.paymentDate
        ? new Date(body.payment.paymentDate)
        : new Date(),
    }
  } else if (eventName === "PAYMENT_OVERDUE") {
    event = { type: "EXPIRED", providerPaymentId: paymentId }
  } else if (eventName === "PAYMENT_DELETED") {
    event = { type: "CANCELLED", providerPaymentId: paymentId }
  } else {
    event = { type: "UNKNOWN" }
  }

  return { event, eventId }
}

function mapAsaasStatus(
  status: string,
  paymentDate?: string
): Pick<ProviderStatusResult, "status" | "externalStatus" | "paidAt"> {
  const result = {
    externalStatus: status,
    paidAt: paymentDate ? new Date(paymentDate) : undefined,
  }
  switch (status) {
    case "RECEIVED":
    case "CONFIRMED":
    case "RECEIVED_IN_CASH":
      return { ...result, status: "PAGO" as const }
    case "OVERDUE":
      return { ...result, status: "EXPIRADO" as const }
    case "REFUNDED":
    case "CHARGEBACK_REQUESTED":
    case "CHARGEBACK_DISPUTE":
      return { ...result, status: "CANCELADO" as const }
    case "PENDING":
    case "AWAITING_RISK_ANALYSIS":
      return { ...result, status: "PENDENTE" as const }
    default:
      return { ...result, status: "PENDENTE" as const }
  }
}

/** Testa a chave consultando o saldo da conta (valida a autenticação). */
export async function testAsaasConnection(
  apiKey: string
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(`${BASE_URL}/finance/balance`, {
      method: "GET",
      headers: headers(apiKey),
    })

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        message: "Chave inválida — o Asaas recusou a autenticação",
      }
    }
    if (!response.ok) {
      return {
        success: false,
        message: `Asaas respondeu ${response.status}`,
      }
    }
    return { success: true, message: "Chave válida — conexão com o Asaas OK" }
  } catch {
    return {
      success: false,
      message: "Falha ao conectar no Asaas. Verifique sua internet.",
    }
  }
}
