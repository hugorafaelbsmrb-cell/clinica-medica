/**
 * Provedor Asaas — cobranças PIX e cartão de crédito.
 *
 * API REST simples (https://api.asaas.com/v3) com autenticação pelo header
 * `access_token`. Não precisa de SDK: usamos fetch direto.
 *
 * Meios de pagamento:
 *  - PIX: QR code + copia-e-cola já vêm na resposta;
 *  - cartão: cobrança criada com billingType CREDIT_CARD e paga de forma
 *    transparente via payWithCreditCard (sem checkout hospedado do Asaas).
 * Documentação: https://docs.asaas.com/reference/api-de-pagamentos
 */
import type {
  CreateChargeInput,
  CreateChargeResult,
  NormalizedPaymentEvent,
  ProviderStatusResult,
} from "@/lib/payments/types"
import { isValidCpf } from "@/lib/cpf"

const PROD_BASE_URL = "https://api.asaas.com/v3"
const SANDBOX_BASE_URL = "https://api-sandbox.asaas.com/v3"

/**
 * Ambiente detectado por chave. As chaves de sandbox e de produção têm o
 * mesmo formato ($aact_...), então a distinção é feita na primeira chamada:
 * produção recusa chave de sandbox com 401/403 e aí tentamos a sandbox.
 * O resultado fica em cache para as próximas chamadas com a mesma chave.
 */
const environmentByKey = new Map<string, "prod" | "sandbox">()

/**
 * Fetch na API do Asaas resolvendo o ambiente automaticamente:
 * usa a URL de produção; se a chave for recusada (401/403), tenta a sandbox
 * e memoriza o ambiente que aceitou a chave.
 */
async function asaasFetch(
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<{ response: Response; environment: "prod" | "sandbox" }> {
  const known = environmentByKey.get(apiKey)
  if (known) {
    const base = known === "sandbox" ? SANDBOX_BASE_URL : PROD_BASE_URL
    return {
      response: await fetch(`${base}${path}`, { ...init, headers: headers(apiKey) }),
      environment: known,
    }
  }

  const production = await fetch(`${PROD_BASE_URL}${path}`, {
    ...init,
    headers: headers(apiKey),
  })
  if (production.status !== 401 && production.status !== 403) {
    environmentByKey.set(apiKey, "prod")
    return { response: production, environment: "prod" }
  }

  // Produção recusou a chave — pode ser chave de sandbox. Tenta o ambiente
  // de testes antes de concluir que a chave é inválida.
  const sandbox = await fetch(`${SANDBOX_BASE_URL}${path}`, {
    ...init,
    headers: headers(apiKey),
  })
  if (sandbox.status !== 401 && sandbox.status !== 403) {
    environmentByKey.set(apiKey, "sandbox")
    return { response: sandbox, environment: "sandbox" }
  }

  // Recusada nos dois ambientes: chave realmente inválida.
  environmentByKey.set(apiKey, "prod")
  return { response: production, environment: "prod" }
}

type AsaasPayment = {
  id: string
  status: string
  value?: number
  invoiceUrl?: string
  pixQrCodeUrl?: string
  encodedImage?: string
  payload?: string
  paymentDate?: string
}

function headers(apiKey: string): Record<string, string> {
  return {
    access_token: apiKey,
    "Content-Type": "application/json",
  }
}

function dataUriForEncodedImage(
  encoded: string | undefined
): string | undefined {
  if (!encoded) return undefined
  // O Asaas devolve o QR em base64 puro; o <img> precisa de um data URI.
  if (encoded.startsWith("data:")) return encoded
  return `data:image/png;base64,${encoded}`
}

/**
 * Busca o QR Code PIX de uma cobrança já criada
 * (GET /payments/{id}/pixQrCode). Usado como fallback quando a resposta
 * da criação vem sem payload/QR — comum logo após o cadastro da chave PIX
 * ou quando o QR ainda não estava pronto.
 */
async function getAsaasPixQrCode(
  providerPaymentId: string,
  apiKey: string
): Promise<{ payload?: string; encodedImage?: string } | null> {
  try {
    const { response } = await asaasFetch(
      apiKey,
      `/payments/${providerPaymentId}/pixQrCode`
    )
    if (!response.ok) return null
    const data = (await response.json().catch(() => ({}))) as {
      success?: boolean
      payload?: string
      encodedImage?: string
    }
    if (!data.success) return null
    return { payload: data.payload, encodedImage: data.encodedImage }
  } catch {
    return null
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

    // Parcelado (2+ parcelas no cartão): o Asaas usa installmentCount +
    // installmentValue no lugar de value (cobrança única manda só value).
    // A resposta é a 1ª parcela — seu webhook de pagamento baixa o
    // lançamento inteiro localmente (simplificação do sistema).
    const isInstallment =
      input.method === "CARTAO" &&
      !!input.installments &&
      input.installments > 1
    const body: Record<string, unknown> = {
      billingType: input.method === "CARTAO" ? "CREDIT_CARD" : "PIX",
      ...(isInstallment
        ? {
            installmentCount: input.installments,
            installmentValue: Number(
              (
                input.installmentValue ??
                input.amountCents / 100 / (input.installments ?? 1)
              ).toFixed(2)
            ),
          }
        : { value: Number((input.amountCents / 100).toFixed(2)) }),
      dueDate,
      description: input.description.slice(0, 500),
      externalReference: `clinica-medica`,
    }
    if (input.customerName) {
      body.customer = {
        name: input.customerName.slice(0, 255),
        // CPF inválido derruba a cobrança no Asaas ("CPF/CNPJ inválido");
        // nesse caso omitimos o campo e a cobrança segue só com o nome.
        ...(input.customerCpf && isValidCpf(input.customerCpf)
          ? { cpfCnpj: input.customerCpf.replace(/\D/g, "") }
          : {}),
      }
    }

    const { response } = await asaasFetch(apiKey, "/payments", {
      method: "POST",
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

    let payload = data.payload
    let qrUrl = data.pixQrCodeUrl ?? dataUriForEncodedImage(data.encodedImage)

    // PIX sem QR/copia-e-cola na resposta: tenta o endpoint dedicado antes
    // de concluir. Sem chave PIX cadastrada na conta, o Asaas cria a
    // cobrança mas não devolve os dados do QR — aí a cobrança é inutilizável
    // e avisamos com clareza em vez de mostrar um resultado vazio.
    if (input.method === "PIX" && (!payload || !qrUrl)) {
      const pix = await getAsaasPixQrCode(data.id, apiKey)
      payload = payload ?? pix?.payload
      qrUrl = qrUrl ?? dataUriForEncodedImage(pix?.encodedImage)
    }

    if (input.method === "PIX" && (!payload || !qrUrl)) {
      return {
        ok: false,
        error:
          "O Asaas criou a cobrança, mas não gerou o QR Code PIX. Cadastre uma chave PIX na conta Asaas (Configurações → Chaves Pix) e tente novamente.",
      }
    }

    return {
      ok: true,
      providerPaymentId: data.id,
      checkoutUrl: data.invoiceUrl,
      pixCopiaCola: payload,
      pixQrCodeUrl: qrUrl,
      externalStatus: data.status,
    }
  } catch {
    return {
      ok: false,
      error: "Falha ao conectar no Asaas. Verifique a conexão e a chave.",
    }
  }
}

export type AsaasCardInput = {
  /** Nome impresso no cartão. */
  holderName: string
  /** Número do cartão (somente dígitos). */
  number: string
  /** Mês de validade "MM". */
  expiryMonth: string
  /** Ano de validade "AAAA". */
  expiryYear: string
  /** Código de segurança. */
  ccv: string
  /** E-mail do titular — obrigatório no Asaas (payWithCreditCard). */
  holderEmail: string
  holderCpf?: string
  /** CEP do titular — obrigatório no Asaas (payWithCreditCard). */
  holderPostalCode: string
  /** Número do endereço do titular — obrigatório no Asaas. */
  holderAddressNumber: string
  holderPhone?: string
  /** Parcelamento: nº de parcelas e valor de cada (2+ parcelas no cartão). */
  installmentCount?: number
  installmentValue?: number
  /** IP do comprador (análise antifraude). */
  remoteIp?: string
}

/**
 * Paga uma cobrança já criada com cartão de crédito, de forma transparente:
 * o cartão é processado direto no Asaas (payWithCreditCard), sem checkout
 * hospedado. Cartão aprovado volta com status CONFIRMED; recusado, o Asaas
 * responde 400 com a descrição do motivo (a cobrança não é persistida).
 */
export async function payAsaasCard(
  providerPaymentId: string,
  apiKey: string,
  card: AsaasCardInput
): Promise<{ ok: boolean; status?: string; paidAt?: Date; error?: string }> {
  try {
    const body: Record<string, unknown> = {
      creditCard: {
        holderName: card.holderName.slice(0, 100),
        number: card.number,
        expiryMonth: card.expiryMonth,
        expiryYear: card.expiryYear,
        ccv: card.ccv,
      },
      creditCardHolderInfo: {
        name: card.holderName.slice(0, 200),
        // Sem e-mail o Asaas recusa a transação
        // ("Informe o email do titular do cartão.").
        email: card.holderEmail.slice(0, 100),
        ...(card.holderCpf ? { cpfCnpj: card.holderCpf } : {}),
        // Sem CEP e número o Asaas recusa a transação
        // ("Informe o CEP do titular do cartão.").
        postalCode: card.holderPostalCode.replace(/\D/g, ""),
        addressNumber: card.holderAddressNumber.slice(0, 20),
        ...(card.holderPhone ? { mobilePhone: card.holderPhone } : {}),
      },
    }
    // Parcelado: parcela × quantidade precisa ser exatamente o valor da
    // cobrança (o valor é atualizado antes, via updateAsaasPaymentValue).
    if (
      card.installmentCount &&
      card.installmentCount > 1 &&
      card.installmentValue
    ) {
      body.installmentCount = card.installmentCount
      body.installmentValue = card.installmentValue
    }
    if (card.remoteIp) body.remoteIp = card.remoteIp

    const { response } = await asaasFetch(
      apiKey,
      `/payments/${providerPaymentId}/payWithCreditCard`,
      { method: "POST", body: JSON.stringify(body) }
    )
    const data = (await response.json().catch(() => ({}))) as AsaasPayment & {
      errors?: { description?: string }[]
    }

    if (!response.ok) {
      const detail =
        data.errors?.[0]?.description ?? `Asaas respondeu ${response.status}`
      return { ok: false, error: detail }
    }
    return {
      ok: true,
      status: data.status,
      paidAt: data.paymentDate ? new Date(data.paymentDate) : undefined,
    }
  } catch {
    return {
      ok: false,
      error: "Falha ao conectar no Asaas ao processar o cartão.",
    }
  }
}

/**
 * Atualiza o valor de uma cobrança PENDENTE no Asaas. Usado no parcelamento
 * com juros: o total precisa existir na cobrança antes do payWithCreditCard,
 * pois o gateway exige parcela × quantidade = valor da cobrança.
 */
export async function updateAsaasPaymentValue(
  providerPaymentId: string,
  value: number,
  apiKey: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { response } = await asaasFetch(
      apiKey,
      `/payments/${providerPaymentId}`,
      { method: "PUT", body: JSON.stringify({ value }) }
    )
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        errors?: { description?: string }[]
      }
      return {
        ok: false,
        error:
          data.errors?.[0]?.description ?? `Asaas respondeu ${response.status}`,
      }
    }
    return { ok: true }
  } catch {
    return {
      ok: false,
      error: "Falha ao conectar no Asaas ao atualizar a cobrança.",
    }
  }
}

/** Consulta o status de um pagamento no Asaas. */
export async function getAsaasPaymentStatus(
  providerPaymentId: string,
  apiKey: string
): Promise<ProviderStatusResult> {
  try {
    const { response } = await asaasFetch(
      apiKey,
      `/payments/${providerPaymentId}`
    )
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
 * PAYMENT_DELETED (cancelado), PAYMENT_REFUNDED/CHARGEBACK_* (estornado).
 * O resto é ignorado (UNKNOWN).
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
  } else if (
    eventName === "PAYMENT_REFUNDED" ||
    eventName === "PAYMENT_REFUND_IN_PROGRESS" ||
    eventName === "PAYMENT_CHARGEBACK_REQUESTED" ||
    eventName === "PAYMENT_CHARGEBACK_DISPUTE"
  ) {
    event = { type: "REFUNDED", providerPaymentId: paymentId }
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
      return { ...result, status: "REFUNDED" as const }
    case "PENDING":
    case "AWAITING_RISK_ANALYSIS":
      return { ...result, status: "PENDENTE" as const }
    default:
      return { ...result, status: "PENDENTE" as const }
  }
}

/**
 * Testa a chave consultando o saldo da conta (valida a autenticação) e,
 * de quebra, verifica se há chave PIX cadastrada — sem ela o Asaas não
 * devolve QR Code nem copia-e-cola nas cobranças PIX.
 */
export async function testAsaasConnection(
  apiKey: string
): Promise<{ success: boolean; message: string }> {
  try {
    const { response, environment } = await asaasFetch(
      apiKey,
      "/finance/balance"
    )

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

    const environmentLabel =
      environment === "sandbox" ? "Asaas Sandbox" : "Asaas"

    // Sem chave PIX cadastrada, cobranças PIX nascem sem QR/copia-e-cola.
    try {
      const pix = await asaasFetch(apiKey, "/pix/addressKeys")
      const pixData = (await pix.response.json().catch(() => ({}))) as {
        data?: unknown[]
      }
      if (pix.response.ok && (!pixData.data || pixData.data.length === 0)) {
        return {
          success: false,
          message: `Chave válida (${environmentLabel}), mas a conta não tem chave PIX cadastrada — sem ela o sistema não gera QR Code nem copia-e-cola. Cadastre em: Asaas → Configurações → Chaves Pix.`,
        }
      }
    } catch {
      // Consulta das chaves PIX falhou — a chave da API continua válida.
    }

    return {
      success: true,
      message: `Chave válida — conexão com o ${environmentLabel} OK`,
    }
  } catch {
    return {
      success: false,
      message: "Falha ao conectar no Asaas. Verifique sua internet.",
    }
  }
}
