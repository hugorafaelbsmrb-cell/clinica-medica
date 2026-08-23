"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import {
  createCharge,
  refreshPaymentStatus,
  simulatePaymentPaid,
} from "@/lib/payments/router"
import { cancelPendingPayment } from "@/lib/payments/cancellation"
import { invalidatePaymentSettingsCache } from "@/lib/payments/settings"
import { testAsaasConnection } from "@/lib/payments/asaas"
import { testStripeConnection } from "@/lib/payments/stripe"
import type { PaymentMethodType } from "@/lib/payments/types"

export type ActionState = {
  success: boolean
  message: string
}

export type CreatePaymentResult = {
  success: boolean
  message: string
  paymentId?: string
  checkoutUrl?: string
  pixCopiaCola?: string
  pixQrCodeUrl?: string
  method?: PaymentMethodType
  provider?: string
  /** true = cobrança em modo teste (gateway sem chave configurada). */
  mock?: boolean
}

const paymentKeysSchema = z.object({
  asaasApiKey: z.string().optional(),
  stripeSecretKey: z.string().optional(),
  stripeWebhookSecret: z.string().optional(),
  consultaPrecoPresencial: z.string().optional(),
  consultaPrecoDomiciliar: z.string().optional(),
  consultaPrecoTeleconsulta: z.string().optional(),
  acompValorBaixa: z.string().optional(),
  acompValorMedia: z.string().optional(),
  acompValorAlta: z.string().optional(),
  jurosParcelamento: z.string().optional(),
})

/** Converte o campo de preço do formulário (aceita vírgula) para número. */
function parsePrice(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim().replace(".", "").replace(",", ".")
  if (!text) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/**
 * Salva as chaves dos gateways e os preços das consultas no registro da
 * clínica (id = 1). Campo vazio remove a credencial salva e desativa o
 * gateway; preço vazio desativa a cobrança no agendamento online.
 */
export async function savePaymentSettings(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return {
      success: false,
      message: "Apenas administradores podem alterar os pagamentos",
    }
  }

  const parsed = paymentKeysSchema.safeParse({
    asaasApiKey: formData.get("asaasApiKey"),
    stripeSecretKey: formData.get("stripeSecretKey"),
    stripeWebhookSecret: formData.get("stripeWebhookSecret"),
    consultaPrecoPresencial: formData.get("consultaPrecoPresencial"),
    consultaPrecoDomiciliar: formData.get("consultaPrecoDomiciliar"),
    consultaPrecoTeleconsulta: formData.get("consultaPrecoTeleconsulta"),
    acompValorBaixa: formData.get("acompValorBaixa"),
    acompValorMedia: formData.get("acompValorMedia"),
    acompValorAlta: formData.get("acompValorAlta"),
    jurosParcelamento: formData.get("jurosParcelamento"),
  })
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }

  const data = parsed.data
  await prisma.clinicSettings.upsert({
    where: { id: 1 },
    update: {
      asaasApiKey: data.asaasApiKey?.trim() || null,
      stripeSecretKey: data.stripeSecretKey?.trim() || null,
      stripeWebhookSecret: data.stripeWebhookSecret?.trim() || null,
      consultaPrecoPresencial: parsePrice(
        formData.get("consultaPrecoPresencial")
      ),
      consultaPrecoDomiciliar: parsePrice(
        formData.get("consultaPrecoDomiciliar")
      ),
      consultaPrecoTeleconsulta: parsePrice(
        formData.get("consultaPrecoTeleconsulta")
      ),
      acompValorBaixa: parsePrice(formData.get("acompValorBaixa")),
      acompValorMedia: parsePrice(formData.get("acompValorMedia")),
      acompValorAlta: parsePrice(formData.get("acompValorAlta")),
      jurosParcelamento:
        parsePrice(formData.get("jurosParcelamento")) ?? 2.99,
    },
    create: {
      id: 1,
      asaasApiKey: data.asaasApiKey?.trim() || null,
      stripeSecretKey: data.stripeSecretKey?.trim() || null,
      stripeWebhookSecret: data.stripeWebhookSecret?.trim() || null,
      consultaPrecoPresencial: parsePrice(
        formData.get("consultaPrecoPresencial")
      ),
      consultaPrecoDomiciliar: parsePrice(
        formData.get("consultaPrecoDomiciliar")
      ),
      consultaPrecoTeleconsulta: parsePrice(
        formData.get("consultaPrecoTeleconsulta")
      ),
      acompValorBaixa: parsePrice(formData.get("acompValorBaixa")),
      acompValorMedia: parsePrice(formData.get("acompValorMedia")),
      acompValorAlta: parsePrice(formData.get("acompValorAlta")),
      jurosParcelamento:
        parsePrice(formData.get("jurosParcelamento")) ?? 2.99,
    },
  })

  invalidatePaymentSettingsCache()

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "ClinicSettings",
      entityId: "pagamentos",
    },
  })

  revalidatePath("/", "layout")
  return { success: true, message: "Configurações de pagamento salvas" }
}

/** Testa a chave de um gateway usando o valor informado no formulário. */
export async function testPaymentGateway(input: {
  provider: "ASAAS" | "STRIPE"
  asaasApiKey?: string
  stripeSecretKey?: string
}): Promise<ActionState> {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return {
      success: false,
      message: "Apenas administradores podem testar os pagamentos",
    }
  }

  if (input.provider === "ASAAS") {
    const key = input.asaasApiKey?.trim()
    if (!key) return { success: false, message: "Informe a chave do Asaas" }
    return testAsaasConnection(key)
  }

  const key = input.stripeSecretKey?.trim()
  if (!key) return { success: false, message: "Informe a chave secreta do Stripe" }
  return testStripeConnection(key)
}

/**
 * Gera uma cobrança vinculada a um lançamento de receita pendente.
 * O gateway é escolhido pelo meio de pagamento (PIX e cartão → Asaas;
 * Apple Pay → Stripe). Se já existir cobrança aberta do mesmo meio,
 * retorna o link existente em vez de duplicar.
 */
export async function createPaymentForEntry(input: {
  entryId: string
  method: PaymentMethodType
}): Promise<CreatePaymentResult> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  requireRole(session, ["ADMIN", "FINANCEIRO"])

  const entry = await prisma.financialEntry.findUnique({
    where: { id: input.entryId },
    include: { payment: true },
  })
  if (!entry) return { success: false, message: "Lançamento não encontrado" }
  if (entry.type !== "RECEITA") {
    return { success: false, message: "Só lançamentos de receita geram cobrança" }
  }
  if (entry.status === "PAGO") {
    return { success: false, message: "Este lançamento já está pago" }
  }

  // Reaproveita cobrança aberta do mesmo meio (evita links duplicados).
  if (entry.payment && entry.payment.status === "PENDENTE") {
    if (entry.payment.method === input.method && entry.payment.checkoutUrl) {
      return {
        success: true,
        message: "Cobrança já gerada — reutilizando o link existente",
        paymentId: entry.payment.id,
        checkoutUrl: entry.payment.checkoutUrl,
        pixCopiaCola: entry.payment.pixCopiaCola ?? undefined,
        pixQrCodeUrl: entry.payment.pixQrCodeUrl ?? undefined,
        method: entry.payment.method,
        provider: entry.payment.provider,
      }
    }
    // Meio de pagamento diferente: encerra a cobrança anterior antes de
    // criar a nova (a entry é mantida para ser cobrada agora).
    await cancelPendingPayment(
      entry.payment.id,
      `Nova cobrança por ${input.method}`
    )
  }

  const patient = entry.attendanceId
    ? await prisma.attendance
        .findUnique({
          where: { id: entry.attendanceId },
          select: { patient: { select: { name: true, cpf: true } } },
        })
        .then((a) => a?.patient ?? null)
    : null

  let result: Awaited<ReturnType<typeof createCharge>>
  try {
    result = await createCharge({
      method: input.method,
      amountCents: Math.round(Number(entry.value) * 100),
      description: `${entry.description} — ${entry.dueDate.toLocaleDateString("pt-BR")}`,
      customerName: patient?.name ?? undefined,
      customerCpf: patient?.cpf ?? undefined,
      financialEntryId: entry.id,
    })
  } catch (error) {
    // P2002: o vínculo Payment↔FinancialEntry é único — outra cobrança
    // acabou de ser criada em paralelo para o mesmo lançamento.
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : undefined
    if (code === "P2002") {
      return {
        success: false,
        message:
          "Uma cobrança para este lançamento acabou de ser gerada — recarregue a página",
      }
    }
    throw error
  }

  if (!result.ok) {
    return {
      success: false,
      message: result.error ?? "Falha ao gerar a cobrança",
    }
  }

  revalidatePath("/financeiro")

  if (input.method === "PIX") {
    return {
      success: true,
      message: "Cobrança PIX gerada",
      paymentId: result.paymentId,
      checkoutUrl: result.checkoutUrl,
      pixCopiaCola: result.pixCopiaCola,
      pixQrCodeUrl: result.pixQrCodeUrl,
      method: input.method,
      provider: result.provider,
      mock: result.mock === true,
    }
  }
  return {
    success: true,
    message: "Link de pagamento gerado",
    paymentId: result.paymentId,
    checkoutUrl: result.checkoutUrl,
    method: input.method,
    provider: result.provider,
    mock: result.mock === true,
  }
}

/** Consulta o gateway e baixa o lançamento se o pagamento foi confirmado. */
export async function refreshPayment(
  paymentId: string
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  requireRole(session, ["ADMIN", "FINANCEIRO", "MEDICO", "SECRETARIA"])

  // Cobrança em modo teste (gateway sem chave): simula a aprovação no
  // lugar da consulta ao gateway.
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (!payment) return { success: false, message: "Cobrança não encontrada" }
  if (payment.provider === "MOCK") {
    const result = await simulatePaymentPaid(paymentId)
    revalidatePath("/financeiro")
    revalidatePath(`/pacientes/${payment.patientId ?? ""}`)
    return { success: result.success, message: result.message }
  }

  const result = await refreshPaymentStatus(paymentId)
  revalidatePath("/financeiro")
  return { success: result.success, message: result.message }
}

const standaloneChargeSchema = z.object({
  patientId: z.string().min(1),
  amount: z.number().positive("Informe um valor válido"),
  method: z.enum(["PIX", "CARTAO"]),
  description: z.string().trim().min(3, "Descreva a cobrança").max(500),
})

/**
 * Cobrança avulsa: admin, médico e secretária geram uma cobrança direta
 * para o paciente (sem lançamento prévio no financeiro). Um lançamento de
 * receita pendente é criado junto e baixado automaticamente pelo webhook.
 */
export async function createStandaloneCharge(input: {
  patientId: string
  amount: number
  method: PaymentMethodType
  description: string
}): Promise<CreatePaymentResult> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  requireRole(session, ["ADMIN", "MEDICO", "SECRETARIA"])

  const parsed = standaloneChargeSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }

  const patient = await prisma.patient.findUnique({
    where: { id: parsed.data.patientId },
  })
  if (!patient) return { success: false, message: "Paciente não encontrado" }

  // Lançamento vinculado → a baixa automática do webhook vale para ambos
  const entry = await prisma.financialEntry.create({
    data: {
      type: "RECEITA",
      category: "OUTRO",
      description: parsed.data.description,
      value: parsed.data.amount,
      dueDate: new Date(),
      status: "PENDENTE",
    },
  })

  const result = await createCharge({
    method: parsed.data.method,
    amountCents: Math.round(parsed.data.amount * 100),
    description: parsed.data.description,
    customerName: patient.name,
    customerCpf: patient.cpf ?? undefined,
    financialEntryId: entry.id,
    patientId: patient.id,
  })

  if (!result.ok) {
    await prisma.financialEntry.delete({ where: { id: entry.id } })
    return {
      success: false,
      message: result.error ?? "Falha ao gerar a cobrança",
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CREATE",
      entity: "Payment",
      entityId: result.paymentId ?? "",
      patientId: patient.id,
      details: {
        cobrancaAvulsa: true,
        amount: parsed.data.amount,
        method: parsed.data.method,
        description: parsed.data.description,
      },
    },
  })

  revalidatePath("/", "layout")

  return {
    success: true,
    message:
      parsed.data.method === "PIX"
        ? "Cobrança PIX gerada"
        : "Link de pagamento gerado",
    paymentId: result.paymentId,
    checkoutUrl: result.checkoutUrl,
    pixCopiaCola: result.pixCopiaCola,
    pixQrCodeUrl: result.pixQrCodeUrl,
    method: parsed.data.method,
    provider: result.provider,
    mock: result.mock === true,
  }
}
