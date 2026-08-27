/**
 * Validação de CPF pelo dígito verificador (algoritmo oficial).
 * Usada para não enviar CPF inválido aos gateways de pagamento
 * (o Asaas recusa a cobrança com "CPF/CNPJ inválido") e para
 * validar o CPF no cadastro público.
 */

/** CPF válido: 11 dígitos, dígitos verificadores corretos e sem repetição. */
export function isValidCpf(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, "")
  if (digits.length !== 11) return false
  // Sequências repetidas (ex.: 111.111.111-11) passam no cálculo, mas
  // não são CPFs reais.
  if (/^(\d)\1{10}$/.test(digits)) return false

  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i)
  let firstCheck = (sum * 10) % 11
  if (firstCheck === 10) firstCheck = 0
  if (firstCheck !== Number(digits[9])) return false

  sum = 0
  for (let i = 0; i < 10; i++) sum += Number(digits[i]) * (11 - i)
  let secondCheck = (sum * 10) % 11
  if (secondCheck === 10) secondCheck = 0
  return secondCheck === Number(digits[10])
}
