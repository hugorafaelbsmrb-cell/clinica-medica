/**
 * Dados da clínica (registro único). Usado no layout do sistema,
 * na página de impressão e na geração dos PDFs.
 */
import { prisma } from "@/lib/prisma"

export type ClinicInfo = {
  name: string
  address?: string | null
  phone?: string | null
  email?: string | null
  cnpj?: string | null
  horarioAtendimento?: string | null
  logoDataUrl?: string | null
  botEnabled?: boolean
  botMsgAtendente?: string | null
  botMsgSaude?: string | null
  botMsgCpfNaoEncontrado?: string | null
  botMsgBoasVindas?: string | null
  botMsgAgendar?: string | null
  autoCadastroEnabled?: boolean
  autoCadastroDelayHours?: number
  autoCadastroMsg?: string | null
  autoCadastroFollowUp2Msg?: string | null
  autoCadastroFollowUp3Msg?: string | null
  autoWhatsappFollowUpEnabled?: boolean
  autoWhatsappFollowUpMsg?: string | null
  autoWhatsappFollowUp2Msg?: string | null
  autoWhatsappFollowUp3Msg?: string | null
  autoTratamentoEnabled?: boolean
  autoTratamentoIntervalDays?: number
  autoTratamentoMsg?: string | null
  autoAniversarioEnabled?: boolean
  autoAniversarioMsg?: string | null
  autoReativacaoEnabled?: boolean
  autoReativacaoDays?: number
  autoReativacaoMsg?: string | null
  autoAgradecimentoEnabled?: boolean
  autoAgradecimentoMsg?: string | null
  autoACaminhoEnabled?: boolean
  autoACaminhoMsg?: string | null
  consultaPrecoPresencial?: number | null
  consultaPrecoDomiciliar?: number | null
  consultaPrecoDomiciliarFora?: number | null
  consultaPrecoTeleconsulta?: number | null
  latitude?: number | null
  longitude?: number | null
  raioUrbanoKm?: number | null
  acompValorBaixa?: number | null
  acompValorMedia?: number | null
  acompValorAlta?: number | null
  jurosParcelamento?: number | null
  autoPagamentoLinkEnabled?: boolean
  autoPagamentoLinkMsg?: string | null
  autoPagamentoLembreteEnabled?: boolean
  autoPagamentoLembreteDelayMinutes?: number
  autoPagamentoLembreteMsg?: string | null
  autoPagamentoConfirmadoEnabled?: boolean
  autoPagamentoConfirmadoMsg?: string | null
  autoAgendamentoFollowUpEnabled?: boolean
  autoAgendamentoFollowUpMsg?: string | null
  autoAgendamentoCanceladoMsg?: string | null
  enableDigitalSignature?: boolean
  consultaPresencialEnabled?: boolean
  consultaDomiciliarEnabled?: boolean
  consultaTeleconsultaEnabled?: boolean
}

const DEFAULTS: ClinicInfo = {
  name: "Médico em Domicílio",
  botEnabled: true,
  autoACaminhoEnabled: true,
  consultaPresencialEnabled: true,
  consultaDomiciliarEnabled: true,
  consultaTeleconsultaEnabled: true,
}

/** Carrega as configurações da clínica, com fallback para o padrão. */
export async function getClinicSettings(): Promise<ClinicInfo> {
  const settings = await prisma.clinicSettings.findUnique({ where: { id: 1 } })
  return settings
    ? {
        name: settings.name,
        address: settings.address,
        phone: settings.phone,
        email: settings.email,
        cnpj: settings.cnpj,
        horarioAtendimento: settings.horarioAtendimento,
        logoDataUrl: settings.logoDataUrl,
        botEnabled: settings.botEnabled,
        botMsgAtendente: settings.botMsgAtendente,
        botMsgSaude: settings.botMsgSaude,
        botMsgCpfNaoEncontrado: settings.botMsgCpfNaoEncontrado,
        botMsgBoasVindas: settings.botMsgBoasVindas,
        botMsgAgendar: settings.botMsgAgendar,
        autoCadastroEnabled: settings.autoCadastroEnabled,
        autoCadastroDelayHours: settings.autoCadastroDelayHours,
        autoCadastroMsg: settings.autoCadastroMsg,
        autoCadastroFollowUp2Msg: settings.autoCadastroFollowUp2Msg,
        autoCadastroFollowUp3Msg: settings.autoCadastroFollowUp3Msg,
        autoWhatsappFollowUpEnabled: settings.autoWhatsappFollowUpEnabled,
        autoWhatsappFollowUpMsg: settings.autoWhatsappFollowUpMsg,
        autoWhatsappFollowUp2Msg: settings.autoWhatsappFollowUp2Msg,
        autoWhatsappFollowUp3Msg: settings.autoWhatsappFollowUp3Msg,
        autoTratamentoEnabled: settings.autoTratamentoEnabled,
        autoTratamentoIntervalDays: settings.autoTratamentoIntervalDays,
        autoTratamentoMsg: settings.autoTratamentoMsg,
        autoAniversarioEnabled: settings.autoAniversarioEnabled,
        autoAniversarioMsg: settings.autoAniversarioMsg,
        autoReativacaoEnabled: settings.autoReativacaoEnabled,
        autoReativacaoDays: settings.autoReativacaoDays,
        autoReativacaoMsg: settings.autoReativacaoMsg,
        autoAgradecimentoEnabled: settings.autoAgradecimentoEnabled,
        autoAgradecimentoMsg: settings.autoAgradecimentoMsg,
        autoACaminhoEnabled: settings.autoACaminhoEnabled,
        autoACaminhoMsg: settings.autoACaminhoMsg,
        consultaPrecoPresencial: settings.consultaPrecoPresencial
          ? Number(settings.consultaPrecoPresencial)
          : null,
        consultaPrecoDomiciliar: settings.consultaPrecoDomiciliar
          ? Number(settings.consultaPrecoDomiciliar)
          : null,
        consultaPrecoDomiciliarFora: settings.consultaPrecoDomiciliarFora
          ? Number(settings.consultaPrecoDomiciliarFora)
          : null,
        consultaPrecoTeleconsulta: settings.consultaPrecoTeleconsulta
          ? Number(settings.consultaPrecoTeleconsulta)
          : null,
        latitude: settings.latitude,
        longitude: settings.longitude,
        raioUrbanoKm: settings.raioUrbanoKm,
        acompValorBaixa: settings.acompValorBaixa
          ? Number(settings.acompValorBaixa)
          : null,
        acompValorMedia: settings.acompValorMedia
          ? Number(settings.acompValorMedia)
          : null,
        acompValorAlta: settings.acompValorAlta
          ? Number(settings.acompValorAlta)
          : null,
        jurosParcelamento: settings.jurosParcelamento
          ? Number(settings.jurosParcelamento)
          : null,
        autoPagamentoLinkEnabled: settings.autoPagamentoLinkEnabled,
        autoPagamentoLinkMsg: settings.autoPagamentoLinkMsg,
        autoPagamentoLembreteEnabled: settings.autoPagamentoLembreteEnabled,
        autoPagamentoLembreteDelayMinutes:
          settings.autoPagamentoLembreteDelayMinutes,
        autoPagamentoLembreteMsg: settings.autoPagamentoLembreteMsg,
        autoPagamentoConfirmadoEnabled:
          settings.autoPagamentoConfirmadoEnabled,
        autoPagamentoConfirmadoMsg: settings.autoPagamentoConfirmadoMsg,
        autoAgendamentoFollowUpEnabled:
          settings.autoAgendamentoFollowUpEnabled,
        autoAgendamentoFollowUpMsg: settings.autoAgendamentoFollowUpMsg,
        autoAgendamentoCanceladoMsg: settings.autoAgendamentoCanceladoMsg,
        enableDigitalSignature: settings.enableDigitalSignature,
        consultaPresencialEnabled: settings.consultaPresencialEnabled,
        consultaDomiciliarEnabled: settings.consultaDomiciliarEnabled,
        consultaTeleconsultaEnabled: settings.consultaTeleconsultaEnabled,
      }
    : DEFAULTS
}
