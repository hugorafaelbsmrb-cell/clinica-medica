/**
 * Cálculo do parcelamento do acompanhamento (Tabela Price).
 *
 * Usado em dois lugares com a MESMA fórmula para não divergir:
 *  - no modal de iniciar acompanhamento (prévia parcela a parcela);
 *  - na server action, que recalcula o total autoritativo antes de cobrar.
 * Juros mensais configuráveis em Configurações → Pagamentos (padrão 2,99%).
 */

export type InstallmentRow = {
  installments: number
  installmentValue: number
  totalValue: number
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Tabela Price: parcela fixa calculada sobre o valor base com juros
 * compostos mensais. 1x = à vista, sem juros.
 */
export function priceTableInstallments(
  baseValue: number,
  monthlyInterestPercent: number,
  maxInstallments = 12
): InstallmentRow[] {
  const rate = monthlyInterestPercent / 100

  const rows: InstallmentRow[] = [
    {
      installments: 1,
      installmentValue: round2(baseValue),
      totalValue: round2(baseValue),
    },
  ]

  for (let n = 2; n <= maxInstallments; n++) {
    const payment =
      (baseValue * rate) / (1 - Math.pow(1 + rate, -n))
    const installmentValue = round2(payment)
    rows.push({
      installments: n,
      installmentValue,
      totalValue: round2(installmentValue * n),
    })
  }

  return rows
}
