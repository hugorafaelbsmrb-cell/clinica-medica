/**
 * Parcelamento no cartão de crédito (checkout transparente).
 *
 * Módulo puro (sem imports de servidor): usado no cliente (seletor de
 * parcelas no wizard e na página /pagar) e no servidor (router de
 * pagamento) — a mesma conta nos dois lados evita divergência de valores.
 *
 * Regra: juros compostos mensais repassados ao cliente (configurado pelo
 * admin em Configurações → Pagamentos, campo "jurosParcelamento").
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
  /** true = tem juros embutidos. */
  hasInterest: boolean
}

/** Menor valor de parcela aceito pelo gateway. */
const MIN_INSTALLMENT = 5

/** Número máximo de parcelas no cartão. */
export const MAX_INSTALLMENTS = 12

/**
 * Monta as opções de parcelamento para um valor: à vista sem juros e
 * 2×…12× com juros compostos mensais. Para em quantidades cuja parcela
 * ficaria abaixo do mínimo do gateway.
 */
export function buildInstallmentOptions(
  amount: number,
  monthlyInterestPct: number,
  maxInstallments = MAX_INSTALLMENTS
): InstallmentOption[] {
  const base = Math.max(0, Number(amount) || 0)
  const rate = Math.max(0, Number(monthlyInterestPct) || 0) / 100
  const options: InstallmentOption[] = []
  for (let count = 1; count <= maxInstallments; count++) {
    // Juros compostos: cada parcela a mais aplica o juro mensal.
    const total = base * Math.pow(1 + rate, count - 1)
    const installmentValue = Number((total / count).toFixed(2))
    if (installmentValue < MIN_INSTALLMENT) break
    options.push({
      count,
      installmentValue,
      total: Number((installmentValue * count).toFixed(2)),
      hasInterest: count > 1,
    })
  }
  return options
}
