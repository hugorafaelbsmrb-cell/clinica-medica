"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"

export type ActionState = {
  success: boolean
  message: string
  entryId?: string
}

const entrySchema = z.object({
  type: z.enum(["RECEITA", "DESPESA"], {
    error: "Selecione o tipo (receita ou despesa)",
  }),
  category: z.enum(
    [
      "CONSULTA_PRESENCIAL",
      "CONSULTA_DOMICILIAR",
      "TELECONSULTA",
      "ACOMPANHAMENTO",
      "PROCEDIMENTO",
      "MEDICAMENTO",
      "OPERACIONAL",
      "OUTRO",
    ],
    { error: "Selecione a categoria" }
  ),
  description: z.string().min(3, "Informe a descrição"),
  value: z.coerce.number().positive("Valor deve ser maior que zero"),
  dueDate: z.coerce.date({ error: "Data inválida" }),
  paymentMethod: z.string().optional().nullable(),
})

export async function createEntry(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  requireRole(session, ["ADMIN", "FINANCEIRO"])

  const parsed = entrySchema.safeParse({
    type: formData.get("type"),
    category: formData.get("category"),
    description: formData.get("description"),
    value: formData.get("value"),
    dueDate: formData.get("dueDate"),
    paymentMethod: formData.get("paymentMethod") || null,
  })

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }

  const data = parsed.data
  const entry = await prisma.financialEntry.create({
    data: {
      type: data.type,
      category: data.category,
      description: data.description,
      value: data.value,
      dueDate: data.dueDate,
      paymentMethod: data.paymentMethod || null,
      status: "PENDENTE",
    },
  })

  revalidatePath("/financeiro")
  return { success: true, message: "Lançamento criado", entryId: entry.id }
}

export async function updateEntry(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  requireRole(session, ["ADMIN", "FINANCEIRO"])

  const id = formData.get("id")?.toString() ?? ""
  const existing = await prisma.financialEntry.findUnique({ where: { id } })
  if (!existing) return { success: false, message: "Lançamento não encontrado" }

  const parsed = entrySchema.safeParse({
    type: formData.get("type"),
    category: formData.get("category"),
    description: formData.get("description"),
    value: formData.get("value"),
    dueDate: formData.get("dueDate"),
    paymentMethod: formData.get("paymentMethod") || null,
  })

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }

  const data = parsed.data
  await prisma.financialEntry.update({
    where: { id },
    data: {
      type: data.type,
      category: data.category,
      description: data.description,
      value: data.value,
      dueDate: data.dueDate,
      paymentMethod: data.paymentMethod || null,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "FinancialEntry",
      entityId: id,
      details: {
        type: data.type,
        category: data.category,
        description: data.description,
        value: data.value,
      },
    },
  })

  revalidatePath("/financeiro")
  return { success: true, message: "Lançamento atualizado", entryId: id }
}

/** Marca como PAGO ou volta para PENDENTE. */
export async function toggleEntryStatus(entryId: string): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  requireRole(session, ["ADMIN", "FINANCEIRO"])

  const entry = await prisma.financialEntry.findUnique({
    where: { id: entryId },
    include: { payment: { select: { id: true, status: true } } },
  })
  if (!entry) return { success: false, message: "Lançamento não encontrado" }

  const next = entry.status === "PAGO" ? "PENDENTE" : "PAGO"
  // Não reabre lançamento pago por cobrança: o estorno no gateway reabre
  // sozinho (applyPaymentRefunded); reabrir aqui quebraria a consistência.
  if (next === "PENDENTE" && entry.payment?.status === "PAGO") {
    return {
      success: false,
      message:
        "Este lançamento foi pago por uma cobrança — o estorno no gateway reabre o lançamento automaticamente",
    }
  }

  await prisma.financialEntry.update({
    where: { id: entryId },
    data: { status: next },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: next === "PAGO" ? "MARK_PAID" : "MARK_PENDING",
      entity: "FinancialEntry",
      entityId: entryId,
    },
  })

  revalidatePath("/financeiro")
  return {
    success: true,
    message: next === "PAGO" ? "Pagamento confirmado" : "Lançamento reaberto",
    entryId,
  }
}

export async function deleteEntry(entryId: string): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  requireRole(session, ["ADMIN", "FINANCEIRO"])

  const entry = await prisma.financialEntry.findUnique({
    where: { id: entryId },
    include: { payment: { select: { id: true, status: true } } },
  })
  if (!entry) return { success: false, message: "Lançamento não encontrado" }

  // Lançamento com cobrança vinculada não pode sumir do financeiro —
  // encerre a cobrança primeiro (cancelar a consulta/acompanhamento).
  if (entry.payment) {
    return {
      success: false,
      message:
        "Este lançamento tem uma cobrança vinculada — cancele a cobrança antes de excluir",
    }
  }

  await prisma.financialEntry.delete({ where: { id: entryId } })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "DELETE",
      entity: "FinancialEntry",
      entityId: entryId,
      details: {
        type: entry.type,
        category: entry.category,
        description: entry.description,
        value: Number(entry.value),
        status: entry.status,
      },
    },
  })

  revalidatePath("/financeiro")
  return { success: true, message: "Lançamento excluído" }
}
