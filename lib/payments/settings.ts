/**
 * Credenciais dos gateways de pagamento (Asaas e Stripe).
 *
 * O admin configura tudo pela tela Configurações → Pagamentos, salvo no
 * banco (tabela ClinicSettings). As variáveis de ambiente do .env continuam
 * funcionando como fallback — úteis quando a chave não deve ficar no banco.
 */
import { prisma } from "@/lib/prisma"

export type PaymentSettings = {
  asaasApiKey: string
  stripeSecretKey: string
  stripeWebhookSecret: string
  /** Preço da consulta presencial (0 = agendamento online sem cobrança). */
  consultaPrecoPresencial: number
  /** Preço da consulta domiciliar. */
  consultaPrecoDomiciliar: number
}

let cache: PaymentSettings | null = null

/** Carrega as credenciais de pagamento (banco primeiro, .env como fallback). */
export async function getPaymentSettings(): Promise<PaymentSettings> {
  if (cache) return cache

  const settings = await prisma.clinicSettings.findUnique({ where: { id: 1 } })
  cache = {
    asaasApiKey: settings?.asaasApiKey || process.env.ASAAS_API_KEY || "",
    stripeSecretKey:
      settings?.stripeSecretKey || process.env.STRIPE_SECRET_KEY || "",
    stripeWebhookSecret:
      settings?.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET || "",
    consultaPrecoPresencial: Number(settings?.consultaPrecoPresencial ?? 0),
    consultaPrecoDomiciliar: Number(settings?.consultaPrecoDomiciliar ?? 0),
  }
  return cache
}

/** Invalida o cache após o admin salvar novas credenciais. */
export function invalidatePaymentSettingsCache(): void {
  cache = null
}
