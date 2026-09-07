/**
 * Núcleo de cupons de desconto do agendamento público.
 *
 * computeCouponDiscount — regra pura do desconto: PERCENT (com teto
 * maxDiscount) ou FIXED (limitado ao valor da compra).
 * validateCouponFor — checagens de negócio (enabled, validade, maxUses,
 * compra mínima e reuso por paciente) + desconto já calculado.
 *
 * A fonte da verdade final é o servidor no agendamento (agendamento-publico),
 * que revalida e registra o uso dentro da transação.
 */
import { prisma } from "@/lib/prisma"
import type { Coupon } from "@prisma/client"

export type CouponValidationResult = {
  ok: boolean
  message: string
  /** Desconto em R$ (0 quando inválido). */
  discount: number
  /** Preço final em R$ (o preço original quando inválido). */
  finalPrice: number
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function formatBrl(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  })
}

/**
 * Desconto em R$ a partir de um preço em R$. Regra pura, sem checagens.
 * PERCENT aplica discountValue% com teto maxDiscount; FIXED desconta
 * discountValue, nunca abaixo de zero.
 */
export function computeCouponDiscount(
  coupon: Pick<Coupon, "discountType" | "discountValue" | "maxDiscount">,
  price: number
): number {
  if (!(price > 0)) return 0
  const value = Number(coupon.discountValue)
  if (!Number.isFinite(value) || value <= 0) return 0

  let discount: number
  if (coupon.discountType === "PERCENT") {
    discount = price * (value / 100)
    const cap = coupon.maxDiscount ? Number(coupon.maxDiscount) : null
    if (cap !== null && Number.isFinite(cap) && discount > cap) discount = cap
  } else {
    discount = value // FIXED em R$
  }

  if (discount > price) discount = price
  return round2(discount)
}

/**
 * Validação completa para aplicar um cupom a um preço.
 * Com patientId, também bloqueia reuso (1x por paciente via unique).
 */
export async function validateCouponFor(
  coupon: Coupon,
  price: number,
  patientId?: string
): Promise<CouponValidationResult> {
  const base = round2(price)

  if (!coupon.enabled) return fail("Cupom desativado.", base)
  const now = new Date()
  if (coupon.validFrom && now < coupon.validFrom) {
    return fail("Este cupom ainda não está válido.", base)
  }
  if (coupon.validUntil && now > coupon.validUntil) {
    return fail("Este cupom expirou.", base)
  }
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    return fail("Este cupom esgotou.", base)
  }
  const minValue = coupon.minValue ? Number(coupon.minValue) : 0
  if (base < minValue) {
    return fail(`Valor mínimo para este cupom: ${formatBrl(minValue)}.`, base)
  }
  if (patientId) {
    const existing = await prisma.couponUse.findUnique({
      where: { couponId_patientId: { couponId: coupon.id, patientId } },
      select: { id: true },
    })
    if (existing) {
      return fail("Este cupom já foi utilizado por você.", base)
    }
  }

  const discount = computeCouponDiscount(coupon, base)
  if (discount <= 0) return fail("Cupom não se aplica a este valor.", base)

  return {
    ok: true,
    message: "Cupom aplicado!",
    discount,
    finalPrice: round2(base - discount),
  }
}

function fail(message: string, originalPrice: number): CouponValidationResult {
  return { ok: false, message, discount: 0, finalPrice: originalPrice }
}
