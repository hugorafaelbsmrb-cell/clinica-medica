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
}

const DEFAULTS: ClinicInfo = {
  name: "Clínica Médica",
  botEnabled: true,
  autoACaminhoEnabled: true,
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
      }
    : DEFAULTS
}
