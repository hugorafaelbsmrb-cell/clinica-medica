"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import {
  createCharge,
  providerForMethod,
  refreshPaymentStatus,
} from "@/lib/payments/router"
import {
  getPaymentSettings,
  invalidatePaymentSettingsCache,
} from "@/lib/payments/settings"
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
}

const paymentKeysSchema = z.object({
  asaasApiKey: z.string().optional(),
  stripeSecretKey: z.string().optional(),
  stripeWebhookSecret: z.string().optional(),
})

/**
 * Salva as chaves dos gateways no registro da clínica (id = 1).
 * Campo vazio remove a credencial salva e desativa o gateway.
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
    },
    create: {
      id: 1,
      asaasApiKey: data.asaasApiKey?.trim() || null,
      stripeSecretKey: data.stripeSecretKey?.trim() || null,
      stripeWebhookSecret: data.stripeWebhookSecret?.trim() || null,
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
 * O gateway é escolhido pelo meio de pagamento (PIX → Asaas, cartão e
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

  const provider = providerForMethod(input.method)

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
  }

  const settings = await getPaymentSettings()
  const keyConfigured =
    provider === "ASAAS" ? !!settings.asaasApiKey : !!settings.stripeSecretKey
  if (!keyConfigured) {
    return {
      success: false,
      message: `Gateway ${provider === "ASAAS" ? "Asaas" : "Stripe"} não configurado — configure em Configurações → Pagamentos`,
    }
  }

  const patient = entry.attendanceId
    ? await prisma.attendance
        .findUnique({
          where: { id: entry.attendanceId },
          select: { patient: { select: { name: true, cpf: true } } },
        })
        .then((a) => a?.patient ?? null)
    : null

  const result = await createCharge({
    method: input.method,
    amountCents: Math.round(Number(entry.value) * 100),
    description: `${entry.description} — ${entry.dueDate.toLocaleDateString("pt-BR")}`,
    customerName: patient?.name ?? undefined,
    customerCpf: patient?.cpf ?? undefined,
    financialEntryId: entry.id,
  })

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
    }
  }
  return {
    success: true,
    message: "Link de pagamento gerado",
    paymentId: result.paymentId,
    checkoutUrl: result.checkoutUrl,
    method: input.method,
    provider: result.provider,
  }
}

/** Consulta o gateway e baixa o lançamento se o pagamento foi confirmado. */
export async function refreshPayment(
  paymentId: string
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  requireRole(session, ["ADMIN", "FINANCEIRO"])

  const result = await refreshPaymentStatus(paymentId)
  revalidatePath("/financeiro")
  return { success: result.success, message: result.message }
}
