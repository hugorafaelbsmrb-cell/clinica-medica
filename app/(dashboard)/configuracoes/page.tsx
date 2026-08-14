import type { Metadata } from "next"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { getClinicSettings } from "@/lib/clinic"
import { getIntegrationSettings } from "@/lib/integrations"
import { ClinicaForm } from "@/components/configuracoes/clinica-form"
import { IntegracoesForm } from "@/components/configuracoes/integracoes-form"
import { BotForm } from "@/components/configuracoes/bot-form"

export const metadata: Metadata = { title: "Configurações" }

export default async function ConfiguracoesPage() {
  const session = requireRole(await auth(), ["ADMIN"])
  void session
  const [clinic, integrations] = await Promise.all([
    getClinicSettings(),
    getIntegrationSettings(),
  ])

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://clinica.vps10746.panel.icontainer.run"
  const webhookUrl = `${appUrl}/api/webhooks/whatsapp`

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">
          Dados da clínica, integrações (IA e WhatsApp), impressão e PDFs
        </p>
      </div>
      <ClinicaForm initial={clinic} />
      <IntegracoesForm
        initial={integrations}
        clinicPhone={clinic.phone}
        webhookUrl={webhookUrl}
      />
      <BotForm
        initial={{
          botEnabled: clinic.botEnabled ?? true,
          botMsgAtendente: clinic.botMsgAtendente ?? "",
          botMsgSaude: clinic.botMsgSaude ?? "",
          botMsgCpfNaoEncontrado: clinic.botMsgCpfNaoEncontrado ?? "",
          botMsgBoasVindas: clinic.botMsgBoasVindas ?? "",
          botMsgAgendar: clinic.botMsgAgendar ?? "",
        }}
      />
    </div>
  )
}
