/**
 * Roteador de pagamentos — camada única por onde passam todas as cobranças.
 *
 * Decide o gateway pelo meio de pagamento (transparente para o usuário):
 *   PIX       → Asaas   (copia-e-cola + QR code)
 *   CARTAO    → Asaas   (link de pagamento com checkout do cartão)
 *   APPLE_PAY → Stripe  (checkout hospedado)
 *
 * Também concentra a baixa automática: qualquer webhook confirmado dos dois
 * gateways é normalizado aqui e baixa o lançamento do Financeiro sozinho.
 */
import { prisma } from "@/lib/prisma"
import { getClinicSettings } from "@/lib/clinic"
import { getPaymentSettings } from "@/lib/payments/settings"
import { createAsaasCharge, getAsaasPaymentStatus } from "@/lib/payments/asaas"
import {
  createStripeCheckout,
  getStripeCheckoutStatus,
} from "@/lib/payments/stripe"
import {
  renderTemplate,
  sendImmediateMessage,
  queueAppointmentConfirmation,
} from "@/lib/whatsapp/message-service"
import { defaultAutomationMessage } from "@/lib/whatsapp/automations"
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
  // PIX e cartão ficam no Asaas; só o Apple Pay passa pelo Stripe por
  // enquanto (o Stripe exige registro de domínio para as carteiras digitais).
  return method === "APPLE_PAY" ? "STRIPE" : "ASAAS"
}

/** Cria a cobrança no gateway certo e registra no banco. */
export async function createCharge(
  input: Omit<CreateChargeInput, "provider"> & {
    method: PaymentMethodType
    financialEntryId?: string
    attendanceId?: string
    patientId?: string
  }
): Promise<
  CreateChargeResult & { paymentId?: string; provider?: PaymentProviderType }
> {
  const provider = providerForMethod(input.method)
  const settings = await getPaymentSettings()

  // Gateway sem chave configurada → cobrança em modo teste (MOCK) para não
  // travar o fluxo enquanto a clínica não libera o cadastro junto ao gateway.
  const missing =
    provider === "ASAAS" ? !settings.asaasApiKey : !settings.stripeSecretKey
  const effectiveProvider: PaymentProviderType = missing ? "MOCK" : provider

  // Prazo da cobrança: Asaas (PIX/cartão) vence no fim do dia do
  // vencimento; checkout do Stripe expira em 24h. MOCK fica 48h para dar
  // tempo de testar.
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)
  const expiresAt = missing
    ? new Date(Date.now() + 48 * 60 * 60 * 1000)
    : provider === "ASAAS"
      ? endOfToday
      : new Date(Date.now() + 24 * 60 * 60 * 1000)

  const payment = await prisma.payment.create({
    data: {
      provider: effectiveProvider,
      method: input.method,
      amount: Number((input.amountCents / 100).toFixed(2)),
      status: "PENDENTE",
      financialEntryId: input.financialEntryId ?? null,
      attendanceId: input.attendanceId ?? null,
      patientId: input.patientId ?? null,
      expiresAt,
    },
  })

  // Modo teste: não chama gateway nenhum — cria a cobrança simulada e
  // devolve um payload PIX fictício para o fluxo seguir normalmente.
  if (missing) {
    const fakePix = `PIX-MOCK-${payment.id}`
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        providerPaymentId: `mock-${payment.id}`,
        pixCopiaCola: fakePix,
        externalStatus: "MOCK",
      },
    })
    return {
      ok: true,
      mock: true,
      paymentId: payment.id,
      provider: "MOCK",
      providerPaymentId: `mock-${payment.id}`,
      pixCopiaCola: fakePix,
      checkoutUrl: undefined,
      pixQrCodeUrl: undefined,
      externalStatus: "MOCK",
    }
  }

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
  if (payment.provider === "MOCK") {
    return {
      success: false,
      message: "Cobrança em modo teste — use a simulação de pagamento",
    }
  }
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
    if (payment.attendanceId) await releasePendingAttendance(payment.attendanceId)
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
        // Libera o horário reservado no agendamento online
        if (payment.attendanceId) await releasePendingAttendance(payment.attendanceId)
      }
      break
    case "CANCELLED":
      if (payment.status === "PENDENTE") {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: "CANCELADO" },
        })
        if (payment.attendanceId) await releasePendingAttendance(payment.attendanceId)
      }
      break
  }
}

/**
 * Baixa automática: marca a cobrança como paga, baixa o lançamento financeiro
 * vinculado e, quando a cobrança é de um agendamento online, confirma o
 * horário (AGUARDANDO_PAGAMENTO → AGENDADO) e dispara as mensagens de
 * WhatsApp: confirmação da consulta + aviso de pagamento confirmado.
 */
async function applyPaymentPaid(paymentId: string, paidAt: Date): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      attendance: {
        select: {
          id: true,
          status: true,
          patientId: true,
          scheduledAt: true,
          cancelToken: true,
        },
      },
    },
  })
  if (!payment) return
  if (payment.status === "PAGO") return // já baixada — evita mensagens duplicadas

  const methodLabel: Record<PaymentMethodType, string> = {
    PIX: "PIX",
    CARTAO: "CARTAO",
    APPLE_PAY: "APPLE_PAY",
  }

  const confirmAttendance =
    !!payment.attendanceId &&
    payment.attendance?.status === "AGUARDANDO_PAGAMENTO"

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
    ...(confirmAttendance && payment.attendanceId
      ? [
          prisma.attendance.update({
            where: { id: payment.attendanceId },
            data: { status: "AGENDADO" },
          }),
        ]
      : []),
  ])

  await prisma.auditLog.create({
    data: {
      action: "PAYMENT_RECEIVED",
      entity: "Payment",
      entityId: payment.id,
      patientId: payment.patientId ?? payment.attendance?.patientId ?? undefined,
      details: {
        provider: payment.provider,
        method: payment.method,
        amount: Number(payment.amount),
        financialEntryId: payment.financialEntryId,
        attendanceId: payment.attendanceId,
      },
    },
  })

  // Mensagens de WhatsApp (consentimento checado pelo próprio serviço)
  const patientId = payment.patientId ?? payment.attendance?.patientId
  if (patientId) {
    if (confirmAttendance && payment.attendance) {
      await queueAppointmentConfirmation(patientId, {
        id: payment.attendance.id,
        scheduledAt: payment.attendance.scheduledAt,
        cancelToken: payment.attendance.cancelToken,
      })
    }
    await queuePaymentConfirmedMessage(patientId, Number(payment.amount))
  }
}

/**
 * Aviso "pagamento confirmado" via WhatsApp, configurável no painel de
 * Automações (desligado = não envia nada). Envio imediato, na sequência
 * da confirmação da consulta.
 */
async function queuePaymentConfirmedMessage(
  patientId: string,
  amount: number
): Promise<void> {
  const clinic = await getClinicSettings()
  if (!clinic.autoPagamentoConfirmadoEnabled) return

  const patient = await prisma.patient.findUnique({ where: { id: patientId } })
  if (!patient?.phone || !patient.whatsappEnabled || !patient.lgpdConsent) return

  const msg =
    clinic.autoPagamentoConfirmadoMsg?.trim() ||
    defaultAutomationMessage("pagamentoconfirmado")

  await sendImmediateMessage(
    patientId,
    "PAGAMENTO_CONFIRMADO",
    renderTemplate(msg, {
      nome: patient.name.split(" ")[0],
      valor: amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 }),
    })
  )
}

/**
 * Libera o horário reservado por um agendamento online cujo pagamento
 * expirou ou foi cancelado (consulta vira CANCELADO).
 */
async function releasePendingAttendance(attendanceId: string): Promise<void> {
  const attendance = await prisma.attendance.findUnique({
    where: { id: attendanceId },
    select: { id: true, status: true },
  })
  if (!attendance || attendance.status !== "AGUARDANDO_PAGAMENTO") return

  await prisma.attendance.update({
    where: { id: attendance.id },
    data: { status: "CANCELADO" },
  })

  await prisma.auditLog.create({
    data: {
      action: "UPDATE",
      entity: "Attendance",
      entityId: attendance.id,
      details: { motivo: "Pagamento não confirmado — horário liberado" },
    },
  })
}

/**
 * Varre cobranças pendentes vencidas (segurança além dos webhooks): marca
 * como EXPIRADO e libera o horário reservado no agendamento online.
 * Chamado pelo cron a cada 10 minutos.
 */
export async function sweepExpiredPayments(now = new Date()): Promise<number> {
  const expired = await prisma.payment.findMany({
    where: { status: "PENDENTE", expiresAt: { lt: now } },
    select: { id: true, attendanceId: true },
  })

  let released = 0
  for (const payment of expired) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "EXPIRADO" },
    })
    if (payment.attendanceId) {
      await releasePendingAttendance(payment.attendanceId)
      released++
    }
  }
  return released
}

/**
 * Simula a confirmação de uma cobrança em modo teste (provider MOCK), sem
 * tocar em gateway nenhum. Roda exatamente o mesmo caminho de baixa de um
 * webhook real (applyPaymentPaid): confirma o horário reservado, baixa o
 * lançamento financeiro e dispara as mensagens de WhatsApp.
 * Para cobranças ligadas a horário, exige o token público do horário.
 */
export async function simulatePaymentPaid(
  paymentId: string,
  input?: { attendanceId?: string; token?: string }
): Promise<{ success: boolean; message: string; scheduledAt?: string }> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      attendance: {
        select: { id: true, cancelToken: true, scheduledAt: true },
      },
    },
  })
  if (!payment) return { success: false, message: "Cobrança não encontrada" }
  if (payment.provider !== "MOCK") {
    return { success: false, message: "Esta cobrança não é de teste" }
  }
  if (payment.status !== "PENDENTE") {
    return { success: false, message: "Esta cobrança já foi finalizada" }
  }
  // Cobrança ligada a horário reservado: exige o token público do horário
  if (payment.attendanceId) {
    const valid =
      input?.attendanceId === payment.attendanceId &&
      !!input?.token &&
      input.token === payment.attendance?.cancelToken
    if (!valid) {
      return { success: false, message: "Dados de confirmação inválidos" }
    }
  }

  await applyPaymentPaid(payment.id, new Date())

  return {
    success: true,
    message: "Pagamento de teste confirmado!",
    scheduledAt: payment.attendance?.scheduledAt.toISOString(),
  }
}
