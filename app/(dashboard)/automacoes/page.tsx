import type { Metadata } from "next"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { getClinicSettings } from "@/lib/clinic"
import { BotForm } from "@/components/automacoes/bot-form"
import { MensagensForm } from "@/components/automacoes/mensagens-form"

export const metadata: Metadata = { title: "Automações" }

export default async function AutomacoesPage() {
  const session = requireRole(await auth(), ["ADMIN"])
  void session
  const clinic = await getClinicSettings()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Automações</h1>
        <p className="text-muted-foreground">
          Bot de atendimento e mensagens automáticas do WhatsApp
        </p>
      </div>
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
      <MensagensForm
        initial={{
          autoCadastroEnabled: clinic.autoCadastroEnabled ?? true,
          autoCadastroMsg: clinic.autoCadastroMsg ?? "",
          autoCadastroFollowUp2Msg: clinic.autoCadastroFollowUp2Msg ?? "",
          autoCadastroFollowUp3Msg: clinic.autoCadastroFollowUp3Msg ?? "",
          autoWhatsappFollowUpEnabled: clinic.autoWhatsappFollowUpEnabled ?? true,
          autoWhatsappFollowUpMsg: clinic.autoWhatsappFollowUpMsg ?? "",
          autoWhatsappFollowUp2Msg: clinic.autoWhatsappFollowUp2Msg ?? "",
          autoWhatsappFollowUp3Msg: clinic.autoWhatsappFollowUp3Msg ?? "",
          autoTratamentoEnabled: clinic.autoTratamentoEnabled ?? true,
          autoTratamentoIntervalDays: clinic.autoTratamentoIntervalDays ?? 7,
          autoTratamentoMsg: clinic.autoTratamentoMsg ?? "",
          autoAniversarioEnabled: clinic.autoAniversarioEnabled ?? true,
          autoAniversarioMsg: clinic.autoAniversarioMsg ?? "",
          autoReativacaoEnabled: clinic.autoReativacaoEnabled ?? true,
          autoReativacaoDays: clinic.autoReativacaoDays ?? 60,
          autoReativacaoMsg: clinic.autoReativacaoMsg ?? "",
          autoAgradecimentoEnabled: clinic.autoAgradecimentoEnabled ?? true,
          autoAgradecimentoMsg: clinic.autoAgradecimentoMsg ?? "",
          autoACaminhoEnabled: clinic.autoACaminhoEnabled ?? true,
          autoACaminhoMsg: clinic.autoACaminhoMsg ?? "",
          autoPagamentoLinkEnabled: clinic.autoPagamentoLinkEnabled ?? true,
          autoPagamentoLinkMsg: clinic.autoPagamentoLinkMsg ?? "",
          autoPagamentoLembreteEnabled:
            clinic.autoPagamentoLembreteEnabled ?? true,
          autoPagamentoLembreteDelayMinutes:
            clinic.autoPagamentoLembreteDelayMinutes ?? 60,
          autoPagamentoLembreteMsg: clinic.autoPagamentoLembreteMsg ?? "",
          autoPagamentoConfirmadoEnabled:
            clinic.autoPagamentoConfirmadoEnabled ?? true,
          autoPagamentoConfirmadoMsg:
            clinic.autoPagamentoConfirmadoMsg ?? "",
          autoAgendamentoFollowUpEnabled:
            clinic.autoAgendamentoFollowUpEnabled ?? true,
          autoAgendamentoFollowUpMsg:
            clinic.autoAgendamentoFollowUpMsg ?? "",
          autoAgendamentoCanceladoMsg:
            clinic.autoAgendamentoCanceladoMsg ?? "",
        }}
      />
    </div>
  )
}
