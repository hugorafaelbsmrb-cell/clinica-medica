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
import { isValidCpf } from "@/lib/cpf"
import { getClinicSettings } from "@/lib/clinic"
import { getPaymentSettings } from "@/lib/payments/settings"
import { cancelPendingPaymentAndEntry } from "@/lib/payments/cancellation"
import { paymentPageUrl } from "@/lib/payments/url"
import { buildInstallmentOptions } from "@/lib/payments/installments"
import {
  createAsaasCharge,
  getAsaasPaymentStatus,
  payAsaasCard,
  updateAsaasPaymentValue,
} from "@/lib/payments/asaas"
import {
  createStripeCheckout,
  getStripeCheckoutStatus,
} from "@/lib/payments/stripe"
import {
  renderTemplate,
  sendImmediateMessage,
  queueAppointmentConfirmation,
} from "@/lib/whatsapp/message-service"
import {
  defaultAutomationMessage,
  queuePaymentLinkMessage,
} from "@/lib/whatsapp/automations"
import { notifyAppointmentConfirmed } from "@/lib/notifications"
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
    followUpId?: string
    installments?: number | null
    installmentValue?: number | null
    cycleNumber?: number | null
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
      followUpId: input.followUpId ?? null,
      installments: input.installments ?? null,
      installmentValue: input.installmentValue ?? null,
      cycleNumber: input.cycleNumber ?? null,
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
    installments: input.installments ?? undefined,
    installmentValue: input.installmentValue ?? undefined,
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

/** Dados do cartão coletados no checkout transparente do próprio sistema. */
export type CardChargeInput = {
  holderName: string
  number: string
  expiryMonth: string
  expiryYear: string
  ccv: string
  /** E-mail do titular — obrigatório no Asaas para payWithCreditCard. */
  holderEmail: string
  /** CEP do titular — obrigatório no Asaas para payWithCreditCard. */
  holderPostalCode: string
  /** Número do endereço do titular — obrigatório no Asaas. */
  holderAddressNumber: string
  /** Parcelamento escolhido no checkout (1 = à vista). */
  installmentCount?: number
}

/**
 * Paga uma cobrança PENDENTE do Asaas com cartão de crédito sem sair do
 * sistema (payWithCreditCard): os dados do portador vêm do cadastro do
 * paciente e o cartão é processado direto no gateway. Cartão aprovado
 * (CONFIRMED/RECEIVED) já baixa a cobrança e confirma o horário reservado;
 * recusado, o erro do gateway volta para exibir ao paciente.
 */
export async function payChargeWithCard(
  paymentId: string,
  card: CardChargeInput,
  remoteIp?: string
): Promise<{
  success: boolean
  message: string
  scheduledAt?: string
  /** true = em análise (ex.: antifraude); confirmação sai pelo webhook. */
  pending?: boolean
}> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      patient: {
        select: {
          email: true,
          cpf: true,
          zipCode: true,
          number: true,
          phone: true,
        },
      },
      attendance: { select: { scheduledAt: true } },
    },
  })
  if (!payment) return { success: false, message: "Cobrança não encontrada" }
  if (payment.provider !== "ASAAS") {
    return {
      success: false,
      message: "Esta cobrança não aceita cartão direto no sistema",
    }
  }
  if (payment.status !== "PENDENTE") {
    return { success: false, message: "Esta cobrança já foi finalizada" }
  }
  if (!payment.providerPaymentId) {
    return {
      success: false,
      message: "Cobrança sem identificador no gateway",
    }
  }

  const settings = await getPaymentSettings()
  // CPF inválido derruba a transação no Asaas — só envia quando válido.
  const cpf =
    payment.patient?.cpf && isValidCpf(payment.patient.cpf)
      ? payment.patient.cpf.replace(/\D/g, "")
      : undefined

  // Parcelamento escolhido no checkout (1 = à vista, sem juros). Com
  // juros, o total é recalculado e a cobrança é atualizada no Asaas antes
  // do payWithCreditCard — o gateway exige parcela × quantidade = valor.
  const installmentCount = Math.min(
    12,
    Math.max(1, Math.round(card.installmentCount ?? 1))
  )
  let installmentValue = Number(payment.amount)

  if (installmentCount > 1 && payment.installments !== installmentCount) {
    const option = buildInstallmentOptions(
      Number(payment.amount),
      settings.jurosParcelamento
    ).find((o) => o.count === installmentCount)
    if (!option) {
      return {
        success: false,
        message: "Parcelamento indisponível para este valor.",
      }
    }
    // Atualiza o valor no Asaas primeiro: se falhar, nada mudou localmente
    // e o cliente pode tentar de novo.
    const updated = await updateAsaasPaymentValue(
      payment.providerPaymentId,
      option.total,
      settings.asaasApiKey
    )
    if (!updated.ok) {
      return {
        success: false,
        message:
          updated.error ??
          "Não foi possível aplicar o parcelamento. Tente novamente.",
      }
    }
    // Guarda o parcelamento na cobrança local; o total com juros é aplicado
    // no lançamento financeiro quando o pagamento confirma (applyPaymentPaid).
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        installments: installmentCount,
        installmentValue: option.installmentValue,
      },
    })
    installmentValue = option.installmentValue
  } else if (installmentCount > 1) {
    // Parcelamento já aplicado numa tentativa anterior: reusa o valor.
    installmentValue =
      Number(payment.installmentValue ?? 0) || Number(payment.amount)
  }

  const result = await payAsaasCard(payment.providerPaymentId, settings.asaasApiKey, {
    holderName: card.holderName,
    number: card.number,
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
    ccv: card.ccv,
    holderEmail: card.holderEmail,
    holderCpf: cpf,
    holderPostalCode: card.holderPostalCode,
    holderAddressNumber: card.holderAddressNumber,
    holderPhone: payment.patient?.phone?.replace(/\D/g, "") || undefined,
    installmentCount,
    installmentValue,
    remoteIp,
  })

  if (!result.ok) {
    return {
      success: false,
      message:
        result.error ??
        "O cartão foi recusado. Verifique os dados e tente novamente.",
    }
  }

  // Cartão aprovado na hora: baixa a cobrança e confirma o horário.
  if (result.status === "CONFIRMED" || result.status === "RECEIVED") {
    await applyPaymentPaid(payment.id, result.paidAt ?? new Date())
    return {
      success: true,
      message: "Pagamento aprovado!",
      scheduledAt: payment.attendance?.scheduledAt.toISOString(),
    }
  }

  // Em análise (antifraude etc.): a confirmação final sai pelo webhook.
  return {
    success: false,
    pending: true,
    message:
      "Pagamento em análise pelo banco. Continue nesta tela — confirmamos automaticamente.",
  }
}

/**
 * Troca a forma de pagamento de uma cobrança PENDENTE: gera a nova cobrança
 * no meio escolhido e só então cancela a anterior (e o lançamento vinculado).
 * Dinheiro não gera cobrança — só vale para consultas: cancela a cobrança
 * pendente e confirma a consulta direto, para pagamento no ato.
 */
export async function replacePaymentMethod(
  paymentId: string,
  newMethod: PaymentMethodType | "DINHEIRO"
): Promise<{
  success: boolean
  message: string
  /** true = trocou para dinheiro; a consulta já está confirmada. */
  cash?: boolean
  scheduledAt?: string
  /** Id da nova cobrança criada (atualiza o link público /pagar). */
  newPaymentId?: string
}> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      patient: { select: { id: true, name: true, cpf: true } },
      attendance: {
        select: {
          id: true,
          status: true,
          type: true,
          patientId: true,
          scheduledAt: true,
          cancelToken: true,
        },
      },
      financialEntry: {
        select: {
          type: true,
          category: true,
          description: true,
          value: true,
          dueDate: true,
        },
      },
    },
  })
  if (!payment) return { success: false, message: "Cobrança não encontrada" }
  if (payment.status !== "PENDENTE") {
    return { success: false, message: "Esta cobrança já foi finalizada" }
  }
  if (newMethod === payment.method) {
    return {
      success: false,
      message: "A cobrança já está nesta forma de pagamento",
    }
  }

  const settings = await getPaymentSettings()
  const methodEnabled =
    newMethod === "PIX"
      ? settings.pixEnabled
      : newMethod === "CARTAO"
        ? settings.cartaoEnabled
        : newMethod === "APPLE_PAY"
          ? settings.applePayEnabled && Boolean(settings.stripeSecretKey)
          : settings.dinheiroEnabled
  if (!methodEnabled) {
    return {
      success: false,
      message:
        "Esta forma de pagamento não está mais disponível. Escolha outra, por favor.",
    }
  }

  const patientId = payment.patientId ?? payment.attendance?.patientId

  // Dinheiro: sem cobrança antecipada — só para consultas agendadas.
  if (newMethod === "DINHEIRO") {
    if (!payment.attendanceId || !payment.attendance) {
      return {
        success: false,
        message:
          "Pagamento em dinheiro só está disponível para consultas agendadas.",
      }
    }
    if (payment.attendance.type === "TELECONSULTA") {
      return {
        success: false,
        message: "Pagamento em dinheiro não está disponível para teleconsulta.",
      }
    }

    await cancelPendingPaymentAndEntry(
      payment.id,
      "troca para dinheiro no atendimento"
    )
    await prisma.attendance.update({
      where: { id: payment.attendance.id },
      data: {
        status: "AGENDADO",
        value: Number(payment.amount),
        paymentMethod: "DINHEIRO",
      },
    })
    await prisma.auditLog.create({
      data: {
        action: "UPDATE",
        entity: "Attendance",
        entityId: payment.attendance.id,
        patientId: patientId ?? undefined,
        details: {
          motivo: "Troca de forma de pagamento — dinheiro no atendimento",
        },
      },
    })
    if (patientId) {
      await queueAppointmentConfirmation(patientId, {
        id: payment.attendance.id,
        scheduledAt: payment.attendance.scheduledAt,
        cancelToken: payment.attendance.cancelToken,
      })
      await notifyAppointmentConfirmed(payment.attendance.id)
    }
    return {
      success: true,
      message:
        "Consulta confirmada! O pagamento será em dinheiro no atendimento.",
      cash: true,
      scheduledAt: payment.attendance.scheduledAt.toISOString(),
    }
  }

  // Nova cobrança primeiro (se falhar, a antiga continua válida), com um
  // lançamento financeiro copiado do anterior (mesma origem e mesmo valor).
  const newEntry = await prisma.financialEntry.create({
    data: {
      type: payment.financialEntry?.type ?? "RECEITA",
      category: payment.financialEntry?.category ?? "CONSULTA_PRESENCIAL",
      description:
        payment.financialEntry?.description ??
        `Consulta — ${payment.patient?.name ?? "paciente"}`,
      value: payment.financialEntry?.value ?? Number(payment.amount),
      dueDate: payment.financialEntry?.dueDate ?? new Date(),
      status: "PENDENTE",
      attendanceId: payment.attendanceId,
    },
  })

  const charge = await createCharge({
    method: newMethod,
    amountCents: Math.round(Number(payment.amount) * 100),
    description:
      payment.financialEntry?.description ??
      `Consulta — ${payment.patient?.name ?? "paciente"}`,
    customerName: payment.patient?.name,
    customerCpf: payment.patient?.cpf ?? undefined,
    financialEntryId: newEntry.id,
    attendanceId: payment.attendanceId ?? undefined,
    patientId: payment.patientId ?? undefined,
    followUpId: payment.followUpId ?? undefined,
    cycleNumber: payment.cycleNumber ?? undefined,
  })

  if (!charge.ok || !charge.paymentId) {
    await prisma.financialEntry.delete({ where: { id: newEntry.id } })
    console.error(
      "[Pagamento] Falha ao trocar forma de pagamento:",
      charge.error
    )
    return {
      success: false,
      message:
        "Não foi possível gerar o novo pagamento agora. Tente novamente em instantes.",
    }
  }

  // Só encerra a cobrança antiga depois que a nova foi criada com sucesso.
  await cancelPendingPaymentAndEntry(payment.id, `troca para ${newMethod}`)

  // Novo link de pagamento via WhatsApp (consentimento checado pelo serviço)
  if (patientId) {
    await queuePaymentLinkMessage(patientId, {
      checkoutUrl: charge.checkoutUrl ?? null,
      pixCopiaCola: charge.pixCopiaCola ?? null,
      paymentUrl: paymentPageUrl(charge.paymentId),
      amount: Number(payment.amount),
    })
  }

  return {
    success: true,
    message: "Forma de pagamento alterada!",
    newPaymentId: charge.paymentId,
  }
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
  if (result.status === "REFUNDED") {
    await applyPaymentRefunded(payment.id)
    return {
      success: true,
      message: "Pagamento estornado no gateway — lançamento reaberto",
      status: "REFUNDED",
    }
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
    case "REFUNDED":
      await applyPaymentRefunded(payment.id)
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
  if (payment.status === "PAGO" || payment.status === "REFUNDED") return

  const methodLabel: Record<PaymentMethodType, string> = {
    PIX: "PIX",
    CARTAO: "CARTAO",
    APPLE_PAY: "APPLE_PAY",
  }

  // Parcelado no checkout transparente, o valor nominal fica no banco e o
  // total com juros (parcela × quantidade) é aplicado só aqui. Cobrança
  // parcelada criada no painel já nasce com o total no valor nominal — a
  // diferença de centavos de arredondamento é tolerada.
  const installmentTotal =
    payment.installments && payment.installmentValue
      ? Number(payment.installmentValue) * payment.installments
      : null
  const settledValue =
    installmentTotal !== null &&
    Math.abs(installmentTotal - Number(payment.amount)) > 0.005
      ? installmentTotal
      : Number(payment.amount)

  // Confirmação do horário reservado. Se o horário foi liberado por
  // expiração (sweep/webhook) e o pagamento confirmou depois, reativa a
  // consulta quando o slot continua livre; ocupado, registra a necessidade
  // de reembolso para a clínica resolver manualmente.
  let confirmAttendance =
    !!payment.attendanceId &&
    payment.attendance?.status === "AGUARDANDO_PAGAMENTO"

  if (
    payment.attendanceId &&
    payment.attendance &&
    payment.attendance.status === "CANCELADO"
  ) {
    const conflict = await prisma.attendance.findFirst({
      where: {
        scheduledAt: payment.attendance.scheduledAt,
        status: { not: "CANCELADO" },
        id: { not: payment.attendance.id },
      },
      select: { id: true },
    })
    if (!conflict) {
      confirmAttendance = true
    } else {
      await prisma.auditLog.create({
        data: {
          action: "REFUND_NEEDED",
          entity: "Payment",
          entityId: payment.id,
          patientId: payment.patientId ?? payment.attendance.patientId,
          details: {
            motivo:
              "Pagamento confirmado após o horário ser liberado e ocupado — reembolso necessário",
            provider: payment.provider,
            amount: Number(payment.amount),
          },
        },
      })
    }
  }

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "PAGO",
        paidAt,
        ...(installmentTotal !== null ? { amount: settledValue } : {}),
      },
    }),
    ...(payment.financialEntryId
      ? [
          prisma.financialEntry.update({
            where: { id: payment.financialEntryId },
            data: {
              status: "PAGO",
              paymentMethod: methodLabel[payment.method],
              ...(installmentTotal !== null ? { value: settledValue } : {}),
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
        amount: settledValue,
        installments: payment.installments,
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
      // Avisa a equipe no painel (sino) que a reserva virou consulta
      await notifyAppointmentConfirmed(payment.attendance.id)
    }
    await queuePaymentConfirmedMessage(patientId, Number(payment.amount))
  }
}

/**
 * Estorno: o gateway devolveu o dinheiro (REFUNDED/chargeback). Marca a
 * cobrança como estornada e reabre o lançamento financeiro vinculado.
 */
async function applyPaymentRefunded(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (!payment || payment.status !== "PAGO") return

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: "REFUNDED" },
    }),
    ...(payment.financialEntryId
      ? [
          prisma.financialEntry.update({
            where: { id: payment.financialEntryId },
            data: { status: "PENDENTE" },
          }),
        ]
      : []),
  ])

  await prisma.auditLog.create({
    data: {
      action: "PAYMENT_REFUNDED",
      entity: "Payment",
      entityId: payment.id,
      patientId: payment.patientId ?? undefined,
      details: {
        provider: payment.provider,
        method: payment.method,
        amount: Number(payment.amount),
        financialEntryId: payment.financialEntryId,
      },
    },
  })
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
    select: {
      id: true,
      attendanceId: true,
      provider: true,
      providerPaymentId: true,
    },
  })

  let released = 0
  for (const payment of expired) {
    // Antes de expirar, confere o gateway: pagamento confirmado no limite
    // (webhook atrasado) baixa normalmente em vez de liberar o horário.
    if (payment.provider !== "MOCK" && payment.providerPaymentId) {
      const check = await refreshPaymentStatus(payment.id)
      if (check.status === "PAGO" || check.status === "REFUNDED") continue
    }
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
