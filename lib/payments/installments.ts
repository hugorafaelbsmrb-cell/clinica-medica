/**
 * Parcelamento no cartão de crédito (checkout transparente).
 *
 * Módulo puro (sem imports de servidor): usado no cliente (seletor de
 * parcelas no wizard e na página /pagar) e no servidor (router de
 * pagamento) — a mesma conta nos dois lados evita divergência de valores.
 *
 * Regra: a taxa do cartão cobrada pelo Asaas é repassada ao cliente
 * (cobranças online):
 *   1x        → 2,99% + R$ 0,49
 *   2x … 6x   → 3,49% + R$ 0,49
 *   7x … 12x  → 3,99% + R$ 0,49
 * O total exibido é parcela × quantidade — exatamente o que o Asaas exige
 * em payWithCreditCard (parcela × quantidade = valor da cobrança).
 */

export type InstallmentOption = {
  /** Quantidade de parcelas (1 = à vista). */
  count: number
  /** Valor de cada parcela (R$). */
  installmentValue: number
  /** Total cobrado do cliente (parcela × quantidade). */
  total: number
  /** true = taxa do cartão embutida no total. */
  hasInterest: boolean
}

/** Menor valor de parcela aceito pelo gateway. */
const MIN_INSTALLMENT = 5

/** Número máximo de parcelas no cartão. */
export const MAX_INSTALLMENTS = 12

/** Taxa fixa por transação no cartão (R$). */
export const CARD_FIXED_FEE = 0.49

/** Taxa percentual do cartão (Asaas, cobranças online) por faixa de parcelas. */
const CARD_FEE_TABLE = [
  { upTo: 1, rate: 0.0299 },
  { upTo: 6, rate: 0.0349 },
  { upTo: 12, rate: 0.0399 },
] as const

/** Taxa percentual do cartão para uma quantidade de parcelas. */
export function cardFeeRate(count: number): number {
  return (
    CARD_FEE_TABLE.find((row) => count <= row.upTo) ?? CARD_FEE_TABLE[0]
  ).rate
}

/**
 * Monta as opções de parcelamento para um valor, com a taxa do cartão
 * repassada ao cliente em qualquer quantidade (inclusive à vista).
 * Para em quantidades cuja parcela ficaria abaixo do mínimo do gateway.
 */
export function buildInstallmentOptions(
  amount: number,
  maxInstallments = MAX_INSTALLMENTS
): InstallmentOption[] {
  const base = Math.max(0, Number(amount) || 0)
  const options: InstallmentOption[] = []
  for (let count = 1; count <= maxInstallments; count++) {
    // Total com a taxa da operadora (percentual + fixa) por conta do cliente.
    const total = Number(
      (base * (1 + cardFeeRate(count)) + CARD_FIXED_FEE).toFixed(2)
    )
    const installmentValue = Number((total / count).toFixed(2))
    if (installmentValue < MIN_INSTALLMENT) break
    options.push({
      count,
      installmentValue,
      total: Number((installmentValue * count).toFixed(2)),
      hasInterest: total > base,
    })
  }
  return options
}
