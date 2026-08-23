"use server"

/**
 * Ações do módulo Acompanhamentos.
 *
 * Um FollowUpProgram liga um paciente a um programa de acompanhamento clínico
 * com cobrança própria:
 *  - INTEGRAL: valor único (à vista no PIX ou parcelado no cartão com juros
 *    da Tabela Price, repassados ao paciente);
 *  - RECORRENTE: cobrança por ciclo (7/15/30 dias) — a primeira sai na hora
 *    e as próximas são geradas pelo cron (`generateDueFollowUpCharges`).
 */
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { createCharge } from "@/lib/payments/router"
import { cancelPendingPaymentAndEntry } from "@/lib/payments/cancellation"
import { getPaymentSettings } from "@/lib/payments/settings"
import type { PaymentMethodType } from "@/lib/payments/types"
import { sendImmediateMessage } from "@/lib/whatsapp/message-service"
import { priceTableInstallments, round2 } from "@/lib/acompanhamentos/pricing"

export type ActionState = {
  success: boolean
  message: string
}

export type CreateFollowUpResult = {
  success: boolean
  message: string
  followUpId?: string
  paymentId?: string
  checkoutUrl?: string
  pixCopiaCola?: string
  pixQrCodeUrl?: string
  method?: PaymentMethodType
  provider?: string
  mock?: boolean
}

export type CreateFollowUpProgramInput = {
  patientId: string
  complexity: "BAIXA" | "MEDIA" | "ALTA"
  description?: string | null
  billingMode: "INTEGRAL" | "RECORRENTE"
  baseValue: number
  method: PaymentMethodType
  /** Cartão parcelado (modo INTEGRAL): 1x–12x. */
  installments?: number
  /** Modo RECORRENTE: ciclo de 7, 15 ou 30 dias. */
  cycleDays?: number
}

const createFollowUpSchema = z
  .object({
    patientId: z.string().min(1, "Selecione o paciente"),
    complexity: z.enum(["BAIXA", "MEDIA", "ALTA"], {
      error: "Selecione a complexidade",
    }),
    description: z.string().trim().max(2000).optional().nullable(),
    billingMode: z.enum(["INTEGRAL", "RECORRENTE"], {
      error: "Selecione o modo de cobrança",
    }),
    baseValue: z.number().positive("Valor deve ser maior que zero"),
    method: z.enum(["PIX", "CARTAO"], {
      error: "Selecione o meio de pagamento",
    }),
    installments: z.number().int().min(1).max(12).optional(),
    cycleDays: z.number().int().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.billingMode === "INTEGRAL" && data.method === "CARTAO") {
      const n = data.installments ?? 1
      if (n < 1 || n > 12) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Parcelas devem ficar entre 1x e 12x",
          path: ["installments"],
        })
      }
    }
    if (data.billingMode === "RECORRENTE") {
      if (!data.cycleDays || ![7, 15, 30].includes(data.cycleDays)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Ciclo deve ser de 7, 15 ou 30 dias",
          path: ["cycleDays"],
        })
      }
    }
  })

/**
 * Inicia o acompanhamento e gera a primeira cobrança conforme o modo:
 * INTEGRAL à vista (PIX), INTEGRAL parcelado (cartão com juros) ou
 * RECORRENTE (primeira cobrança agora; as próximas ficam por conta do cron).
 */
export async function createFollowUpProgram(
  input: CreateFollowUpProgramInput
): Promise<CreateFollowUpResult> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  requireRole(session, ["ADMIN", "MEDICO"])

  const parsed = createFollowUpSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }

  const data = parsed.data
  const patient = await prisma.patient.findUnique({
    where: { id: data.patientId },
  })
  if (!patient) return { success: false, message: "Paciente não encontrado" }

  const settings = await getPaymentSettings()

  // --- Cálculo da cobrança conforme o modo escolhido ---
  let installments: number | null = null
  let installmentValue: number | null = null
  let totalValue = round2(data.baseValue)
  let cycleDays: number | null = null
  let nextDueAt: Date | null = null

  if (data.billingMode === "INTEGRAL") {
    if (data.method === "CARTAO") {
      const n = data.installments ?? 1
      installments = n
      if (n > 1) {
        const row = priceTableInstallments(
          data.baseValue,
          settings.jurosParcelamento
        ).find((r) => r.installments === n)
        installmentValue = row?.installmentValue ?? round2(data.baseValue / n)
        totalValue = row?.totalValue ?? round2(data.baseValue)
      } else {
        installmentValue = round2(data.baseValue)
        totalValue = round2(data.baseValue)
      }
    }
  } else {
    // RECORRENTE: valor por ciclo; primeira cobrança sai agora.
    cycleDays = data.cycleDays ?? 30
    nextDueAt = new Date(Date.now() + cycleDays * 24 * 60 * 60 * 1000)
    totalValue = round2(data.baseValue)
  }

  const program = await prisma.followUpProgram.create({
    data: {
      patientId: data.patientId,
      doctorId: session.user.role === "MEDICO" ? session.user.id : null,
      status: "ATIVO",
      complexity: data.complexity,
      description: data.description?.trim() || null,
      billingMode: data.billingMode,
      baseValue: round2(data.baseValue),
      totalValue,
      installments,
      installmentValue,
      cycleDays,
      nextDueAt,
    },
  })

  const isRecurring = data.billingMode === "RECORRENTE"
  const entry = await prisma.financialEntry.create({
    data: {
      type: "RECEITA",
      category: "ACOMPANHAMENTO",
      description: `Acompanhamento — ${patient.name}${
        isRecurring ? " (ciclo 1)" : ""
      }`,
      value: totalValue,
      dueDate: new Date(),
      status: "PENDENTE",
    },
  })

  const result = await createCharge({
    method: data.method,
    amountCents: Math.round(totalValue * 100),
    description: `Acompanhamento — ${patient.name}`,
    customerName: patient.name,
    customerCpf: patient.cpf ?? undefined,
    financialEntryId: entry.id,
    patientId: patient.id,
    followUpId: program.id,
    installments: installments ?? undefined,
    installmentValue: installmentValue ?? undefined,
    cycleNumber: isRecurring ? 1 : undefined,
  })

  if (!result.ok) {
    // Desfaz programa e lançamento para não deixar resíduo sem cobrança.
    await prisma.financialEntry.delete({ where: { id: entry.id } })
    await prisma.followUpProgram.delete({ where: { id: program.id } })
    return {
      success: false,
      message: result.error ?? "Falha ao gerar a cobrança",
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CREATE",
      entity: "FollowUpProgram",
      entityId: program.id,
      patientId: patient.id,
      details: {
        complexity: data.complexity,
        billingMode: data.billingMode,
        baseValue: data.baseValue,
        totalValue,
        installments,
        cycleDays,
        method: data.method,
      },
    },
  })

  revalidatePath("/acompanhamentos")
  revalidatePath(`/pacientes/${patient.id}`)

  return {
    success: true,
    message: isRecurring
      ? "Acompanhamento iniciado — primeira cobrança do ciclo gerada"
      : "Acompanhamento iniciado — cobrança gerada",
    followUpId: program.id,
    paymentId: result.paymentId,
    checkoutUrl: result.checkoutUrl,
    pixCopiaCola: result.pixCopiaCola,
    pixQrCodeUrl: result.pixQrCodeUrl,
    method: data.method,
    provider: result.provider,
    mock: result.mock === true,
  }
}

const STATUS_LABELS: Record<string, string> = {
  ATIVO: "Acompanhamento reativado",
  PAUSADO: "Acompanhamento pausado",
  CONCLUIDO: "Acompanhamento concluído",
  CANCELADO: "Acompanhamento cancelado",
}

/**
 * Pausa, reativa, conclui ou cancela um acompanhamento.
 * Concluir/cancelar encerra a recorrência; cancelar também derruba as
 * cobranças pendentes vinculadas ao programa.
 */
export async function updateFollowUpStatus(
  id: string,
  status: "ATIVO" | "PAUSADO" | "CONCLUIDO" | "CANCELADO"
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  requireRole(session, ["ADMIN", "MEDICO"])

  const program = await prisma.followUpProgram.findUnique({ where: { id } })
  if (!program) {
    return { success: false, message: "Acompanhamento não encontrado" }
  }

  const encerrado = status === "CONCLUIDO" || status === "CANCELADO"
  await prisma.followUpProgram.update({
    where: { id },
    data: {
      status,
      endDate: encerrado ? new Date() : null,
      nextDueAt: encerrado ? null : program.nextDueAt,
    },
  })

  // Cancelar também encerra as cobranças pendentes do programa e remove
  // os lançamentos PENDENTES vinculados (nunca foram pagos).
  if (status === "CANCELADO") {
    const pendingPayments = await prisma.payment.findMany({
      where: { followUpId: id, status: "PENDENTE" },
      select: { id: true },
    })
    for (const payment of pendingPayments) {
      await cancelPendingPaymentAndEntry(
        payment.id,
        "Acompanhamento cancelado"
      )
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "FollowUpProgram",
      entityId: id,
      patientId: program.patientId,
      details: { status },
    },
  })

  revalidatePath("/acompanhamentos")
  revalidatePath(`/acompanhamentos/${id}`)
  revalidatePath(`/pacientes/${program.patientId}`)
  return { success: true, message: STATUS_LABELS[status] }
}

/**
 * Registra uma avaliação clínica (evolução) no acompanhamento.
 * Texto simples, compatível com o VoiceTextarea (voz → texto).
 */
export async function createFollowUpEvaluation(
  followUpId: string,
  notes: string
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  requireRole(session, ["ADMIN", "MEDICO"])

  const trimmed = notes.trim()
  if (trimmed.length < 3) {
    return { success: false, message: "Escreva a avaliação antes de salvar" }
  }

  const program = await prisma.followUpProgram.findUnique({
    where: { id: followUpId },
  })
  if (!program) {
    return { success: false, message: "Acompanhamento não encontrado" }
  }

  await prisma.followUpEvaluation.create({
    data: {
      followUpId,
      doctorId: session.user.role === "MEDICO" ? session.user.id : null,
      notes: trimmed,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CREATE",
      entity: "FollowUpEvaluation",
      entityId: followUpId,
      patientId: program.patientId,
    },
  })

  revalidatePath(`/acompanhamentos/${followUpId}`)
  return { success: true, message: "Avaliação registrada" }
}

/**
 * Gera a cobrança de um ciclo vencido de um programa RECORRENTE ativo.
 * Cria o lançamento + cobrança, avança o próximo vencimento mantendo a
 * cadência e envia o link de pagamento pelo WhatsApp. Usado pelo cron.
 */
export async function generateFollowUpRecurringCharge(
  followUpId: string,
  now = new Date()
): Promise<{ ok: boolean; message: string }> {
  const program = await prisma.followUpProgram.findUnique({
    where: { id: followUpId },
    include: {
      patient: true,
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  })
  if (!program) return { ok: false, message: "Acompanhamento não encontrado" }
  if (program.status !== "ATIVO" || program.billingMode !== "RECORRENTE") {
    return { ok: false, message: "Acompanhamento não está ativo na recorrência" }
  }
  if (!program.nextDueAt || program.nextDueAt > now) {
    return { ok: false, message: "Ciclo ainda não venceu" }
  }
  if (!program.cycleDays) {
    return { ok: false, message: "Programa sem ciclo configurado" }
  }

  // Segue o meio de pagamento escolhido na criação (padrão PIX).
  const lastPayment = program.payments[0]
  const method: PaymentMethodType =
    lastPayment?.method === "CARTAO" ? "CARTAO" : "PIX"
  const cycleNumber = program.payments.length + 1
  const value = Number(program.baseValue)

  const entry = await prisma.financialEntry.create({
    data: {
      type: "RECEITA",
      category: "ACOMPANHAMENTO",
      description: `Acompanhamento — ${program.patient.name} (ciclo ${cycleNumber})`,
      value,
      dueDate: new Date(),
      status: "PENDENTE",
    },
  })

  const result = await createCharge({
    method,
    amountCents: Math.round(value * 100),
    description: `Acompanhamento — ${program.patient.name} (ciclo ${cycleNumber})`,
    customerName: program.patient.name,
    customerCpf: program.patient.cpf ?? undefined,
    financialEntryId: entry.id,
    patientId: program.patientId,
    followUpId: program.id,
    cycleNumber,
  })

  if (!result.ok) {
    await prisma.financialEntry.delete({ where: { id: entry.id } })
    return { ok: false, message: result.error ?? "Falha ao gerar a cobrança do ciclo" }
  }

  // Avança o próximo vencimento mantendo a cadência original (ciclos
  // atrasados são alcançados de uma vez, sem gerar cobrança retroativa).
  let next = new Date(
    program.nextDueAt.getTime() + program.cycleDays * 24 * 60 * 60 * 1000
  )
  while (next.getTime() <= now.getTime()) {
    next = new Date(next.getTime() + program.cycleDays * 24 * 60 * 60 * 1000)
  }
  await prisma.followUpProgram.update({
    where: { id: program.id },
    data: { nextDueAt: next },
  })

  // Link de pagamento pelo WhatsApp (respeita consentimento LGPD).
  const url = result.checkoutUrl ?? result.pixCopiaCola
  if (
    url &&
    program.patient.phone &&
    program.patient.whatsappEnabled &&
    program.patient.lgpdConsent
  ) {
    const valor = value.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    })
    const content = `Olá ${
      program.patient.name.split(" ")[0]
    }! Chegou o ciclo ${cycleNumber} do seu acompanhamento (${valor}). Pague pelo link: ${url}`
    await sendImmediateMessage(program.patientId, "LINK_PAGAMENTO", content)
  }

  await prisma.auditLog.create({
    data: {
      action: "CREATE",
      entity: "Payment",
      entityId: result.paymentId ?? "",
      patientId: program.patientId,
      details: { followUpId: program.id, cycleNumber, recurring: true },
    },
  })

  return { ok: true, message: `Ciclo ${cycleNumber} gerado` }
}

/**
 * Varre programas RECORRENTE ativos com ciclo vencido e gera a cobrança de
 * cada um. Chamado pelo cron a cada 10 minutos. Retorna quantos gerou.
 */
export async function generateDueFollowUpCharges(now = new Date()): Promise<number> {
  const due = await prisma.followUpProgram.findMany({
    where: {
      status: "ATIVO",
      billingMode: "RECORRENTE",
      nextDueAt: { lte: now },
    },
    select: { id: true },
  })

  let generated = 0
  for (const program of due) {
    const result = await generateFollowUpRecurringCharge(program.id, now)
    if (result.ok) {
      generated++
    } else {
      console.error(
        `[Acompanhamento] Falha no ciclo do programa ${program.id}: ${result.message}`
      )
    }
  }
  return generated
}
