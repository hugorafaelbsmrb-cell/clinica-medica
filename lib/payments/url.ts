/**
 * URL pública do sistema para links enviados ao paciente.
 * Usada para apontar para a página de pagamento própria (/pagar/[id])
 * no lugar do checkout hospedado do gateway.
 */

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://painel.medicoemdomicilio.com"

/** Link da página de pagamento transparente do próprio sistema. */
export function paymentPageUrl(paymentId: string): string {
  return `${APP_URL}/pagar/${paymentId}`
}
