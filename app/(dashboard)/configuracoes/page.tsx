import type { Metadata } from "next"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { getClinicSettings } from "@/lib/clinic"
import { getIntegrationSettings } from "@/lib/integrations"
import { getPaymentSettings } from "@/lib/payments/settings"
import { ClinicaForm } from "@/components/configuracoes/clinica-form"
import { IntegracoesForm } from "@/components/configuracoes/integracoes-form"
import { PagamentosForm } from "@/components/configuracoes/pagamentos-form"
import { WebhooksForm } from "@/components/configuracoes/webhooks-form"

export const metadata: Metadata = { title: "Configurações" }

export default async function ConfiguracoesPage() {
  const session = requireRole(await auth(), ["ADMIN"])
  void session
  const [clinic, integrations, payments] = await Promise.all([
    getClinicSettings(),
    getIntegrationSettings(),
    getPaymentSettings(),
  ])

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://painel.medicoemdomicilio.com"
  const webhookUrl = `${appUrl}/api/webhooks/whatsapp`
  const asaasWebhookUrl = `${appUrl}/api/webhooks/asaas`
  const stripeWebhookUrl = `${appUrl}/api/webhooks/stripe`

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">
          Dados da clínica, integrações (IA e WhatsApp), pagamentos e PDFs
        </p>
      </div>
      <ClinicaForm initial={clinic} />
      <IntegracoesForm
        initial={integrations}
        clinicPhone={clinic.phone}
        webhookUrl={webhookUrl}
      />
      <WebhooksForm
        initial={{
          whatsappWebhookUrl: webhookUrl,
          asaasWebhookUrl,
          stripeWebhookUrl,
        }}
      />
      <PagamentosForm
        initial={{
          asaasApiKey: payments.asaasApiKey,
          stripeSecretKey: payments.stripeSecretKey,
          stripeWebhookSecret: payments.stripeWebhookSecret,
          asaasWebhookUrl,
          stripeWebhookUrl,
          consultaPrecoPresencial: clinic.consultaPrecoPresencial ?? null,
          consultaPrecoDomiciliar: clinic.consultaPrecoDomiciliar ?? null,
          consultaPrecoDomiciliarFora:
            clinic.consultaPrecoDomiciliarFora ?? null,
          consultaPrecoTeleconsulta: clinic.consultaPrecoTeleconsulta ?? null,
          acompValorBaixa: clinic.acompValorBaixa ?? null,
          acompValorMedia: clinic.acompValorMedia ?? null,
          acompValorAlta: clinic.acompValorAlta ?? null,
          jurosParcelamento: clinic.jurosParcelamento ?? null,
          pixEnabled: payments.pixEnabled,
          cartaoEnabled: payments.cartaoEnabled,
          applePayEnabled: payments.applePayEnabled,
          dinheiroEnabled: payments.dinheiroEnabled,
        }}
        enabledModalities={{
          presencial: clinic.consultaPresencialEnabled ?? true,
          domiciliar: clinic.consultaDomiciliarEnabled ?? true,
          teleconsulta: clinic.consultaTeleconsultaEnabled ?? true,
        }}
      />
    </div>
  )
}
