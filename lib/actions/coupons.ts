"use server"

/**
 * Ações da aba Cupons do painel /marketing (só ADMIN): CRUD completo.
 * O código é sempre normalizado para uppercase (alfanumérico) e cada
 * operação registra auditoria (AuditLog).
 */
import { z } from "zod"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { requireRole } from "@/lib/rbac"

export type CouponActionState = { success: boolean; message: string }

const CODE_RE = /^[A-Z0-9]{3,30}$/

const couponSchema = z
  .object({
    code: z.string().trim().min(1, "Informe o código do cupom").max(30),
    description: z.string().trim().max(300).optional(),
    discountType: z.enum(["PERCENT", "FIXED"]),
    discountValue: z.coerce
      .number({ message: "Informe o valor do desconto" })
      .min(0, "O desconto não pode ser negativo"),
    minValue: z.coerce.number().min(0).optional(),
    maxDiscount: z.coerce.number().min(0).optional(),
    maxUses: z.coerce.number().int().min(1).optional(),
    validFrom: z.string().optional(),
    validUntil: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const code = data.code.toUpperCase().replace(/\s+/g, "")
    if (!CODE_RE.test(code)) {
      ctx.addIssue({
        code: "custom",
        message: "Código deve ter 3 a 30 caracteres alfanuméricos (A-Z, 0-9)",
      })
    }
    if (data.discountType === "PERCENT" && data.discountValue > 100) {
      ctx.addIssue({
        code: "custom",
        message: "Percentual de desconto não pode passar de 100%",
      })
    }
    const from = data.validFrom ? new Date(data.validFrom) : null
    const until = data.validUntil ? new Date(data.validUntil) : null
    if (from && Number.isNaN(from.getTime())) {
      ctx.addIssue({ code: "custom", message: "Data inicial inválida" })
    }
    if (until && Number.isNaN(until.getTime())) {
      ctx.addIssue({ code: "custom", message: "Data final inválida" })
    }
    if (from && until && until.getTime() <= from.getTime()) {
      ctx.addIssue({
        code: "custom",
        message: "A validade final precisa ser depois da inicial",
      })
    }
  })

type CouponFormData = {
  code: string
  description: string | null
  discountType: "PERCENT" | "FIXED"
  discountValue: number
  minValue: number | null
  maxDiscount: number | null
  maxUses: number | null
  validFrom: Date | null
  validUntil: Date | null
}

/** Campos comuns do formulário → dados do cupom validados. */
async function parseCouponForm(
  formData: FormData
): Promise<{ success: false; message: string } | { success: true; data: CouponFormData }> {
  const parsed = couponSchema.safeParse({
    code: formData.get("code"),
    description: formData.get("description") || undefined,
    discountType: formData.get("discountType"),
    discountValue: formData.get("discountValue"),
    minValue: formData.get("minValue") || undefined,
    maxDiscount: formData.get("maxDiscount") || undefined,
    maxUses: formData.get("maxUses") || undefined,
    validFrom: formData.get("validFrom") || undefined,
    validUntil: formData.get("validUntil") || undefined,
  })
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }
  const data = parsed.data

  return {
    success: true,
    data: {
      code: data.code.toUpperCase().replace(/\s+/g, ""),
      description: data.description || null,
      discountType: data.discountType,
      discountValue: data.discountValue,
      minValue: data.minValue ?? null,
      maxDiscount: data.maxDiscount ?? null,
      maxUses: data.maxUses ?? null,
      validFrom: data.validFrom ? new Date(data.validFrom) : null,
      validUntil: data.validUntil ? new Date(data.validUntil) : null,
    },
  }
}

function couponUpdateData(data: CouponFormData) {
  return {
    code: data.code,
    description: data.description,
    discountType: data.discountType,
    discountValue: data.discountValue,
    minValue: data.minValue,
    maxDiscount: data.maxDiscount,
    maxUses: data.maxUses,
    validFrom: data.validFrom,
    validUntil: data.validUntil,
  }
}

export async function createCoupon(
  _prev: CouponActionState | null,
  formData: FormData
): Promise<CouponActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  requireRole(session, ["ADMIN"])

  const parsedForm = await parseCouponForm(formData)
  if (!parsedForm.success) return { success: false, message: parsedForm.message }
  const data = parsedForm.data

  const existing = await prisma.coupon.findUnique({
    where: { code: data.code },
    select: { id: true },
  })
  if (existing) {
    return { success: false, message: "Já existe um cupom com este código" }
  }

  const coupon = await prisma.coupon.create({ data: couponUpdateData(data) })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CREATE",
      entity: "Coupon",
      entityId: coupon.id,
      details: { code: coupon.code, discountType: coupon.discountType },
    },
  })

  revalidatePath("/marketing")
  return { success: true, message: `Cupom ${coupon.code} criado` }
}

export async function updateCoupon(
  _prev: CouponActionState | null,
  formData: FormData
): Promise<CouponActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  requireRole(session, ["ADMIN"])

  const id = String(formData.get("id") ?? "").trim()
  if (!id) return { success: false, message: "Cupom não identificado" }

  const existing = await prisma.coupon.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!existing) return { success: false, message: "Cupom não encontrado" }

  const parsedForm = await parseCouponForm(formData)
  if (!parsedForm.success) return { success: false, message: parsedForm.message }
  const data = parsedForm.data

  const duplicate = await prisma.coupon.findFirst({
    where: { code: data.code, id: { not: id } },
    select: { id: true },
  })
  if (duplicate) {
    return { success: false, message: "Já existe outro cupom com este código" }
  }

  const coupon = await prisma.coupon.update({
    where: { id },
    data: couponUpdateData(data),
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "Coupon",
      entityId: coupon.id,
      details: { code: coupon.code },
    },
  })

  revalidatePath("/marketing")
  return { success: true, message: `Cupom ${coupon.code} atualizado` }
}

/** Ativa/desativa um cupom (desativado não é aplicável no checkout). */
export async function toggleCouponEnabled(id: string): Promise<CouponActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  requireRole(session, ["ADMIN"])

  const coupon = await prisma.coupon.findUnique({
    where: { id },
    select: { enabled: true, code: true },
  })
  if (!coupon) return { success: false, message: "Cupom não encontrado" }

  const enabled = !coupon.enabled
  await prisma.coupon.update({ where: { id }, data: { enabled } })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: enabled ? "ENABLE" : "DISABLE",
      entity: "Coupon",
      entityId: id,
      details: { code: coupon.code },
    },
  })

  revalidatePath("/marketing")
  return {
    success: true,
    message: enabled
      ? `Cupom ${coupon.code} ativado`
      : `Cupom ${coupon.code} desativado`,
  }
}

export async function deleteCoupon(id: string): Promise<CouponActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  requireRole(session, ["ADMIN"])

  const coupon = await prisma.coupon.findUnique({
    where: { id },
    select: { code: true },
  })
  if (!coupon) return { success: false, message: "Cupom não encontrado" }

  await prisma.coupon.delete({ where: { id } })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "DELETE",
      entity: "Coupon",
      entityId: id,
      details: { code: coupon.code },
    },
  })

  revalidatePath("/marketing")
  return { success: true, message: `Cupom ${coupon.code} excluído` }
}
