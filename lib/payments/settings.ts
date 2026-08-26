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
  /** Preço da teleconsulta (vídeo chamada). */
  consultaPrecoTeleconsulta: number
  /** Formas de pagamento liberadas para o cliente no agendamento online. */
  pixEnabled: boolean
  cartaoEnabled: boolean
  applePayEnabled: boolean
  dinheiroEnabled: boolean
  /** Valores sugeridos por complexidade no acompanhamento. */
  acompValorBaixa: number
  acompValorMedia: number
  acompValorAlta: number
  /** Juros mensais repassados ao paciente no cartão parcelado (%). */
  jurosParcelamento: number
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
    consultaPrecoTeleconsulta: Number(
      settings?.consultaPrecoTeleconsulta ?? 0
    ),
    pixEnabled: settings?.pixEnabled ?? true,
    cartaoEnabled: settings?.cartaoEnabled ?? true,
    applePayEnabled: settings?.applePayEnabled ?? true,
    dinheiroEnabled: settings?.dinheiroEnabled ?? true,
    acompValorBaixa: Number(settings?.acompValorBaixa ?? 0),
    acompValorMedia: Number(settings?.acompValorMedia ?? 0),
    acompValorAlta: Number(settings?.acompValorAlta ?? 0),
    jurosParcelamento: Number(settings?.jurosParcelamento ?? 2.99),
  }
  return cache
}

/** Invalida o cache após o admin salvar novas credenciais. */
export function invalidatePaymentSettingsCache(): void {
  cache = null
}
