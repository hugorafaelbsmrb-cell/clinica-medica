"use server"

/**
 * Ações da tela de Automações: mensagens automáticas do WhatsApp
 * (cadastro incompleto, tratamento, aniversário, reativação e
 * agradecimento pós-consulta). Apenas administradores.
 */
import { z } from "zod"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"

export type AutomationState = {
  success: boolean
  message: string
}

function flag(formData: FormData, name: string): boolean {
  return formData.get(name) === "on"
}

function intField(formData: FormData, name: string, fallback: number): number {
  const value = Number(formData.get(name))
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}

export async function saveMensagensAutomation(
  _prev: AutomationState | null,
  formData: FormData
): Promise<AutomationState> {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return {
      success: false,
      message: "Apenas administradores podem alterar as automações",
    }
  }

  const msgSchema = z.object({
    cadastro: z.string().max(2000).optional(),
    cadastro2: z.string().max(2000).optional(),
    cadastro3: z.string().max(2000).optional(),
    tratamento: z.string().max(2000).optional(),
    aniversario: z.string().max(2000).optional(),
    reativacao: z.string().max(2000).optional(),
    agradecimento: z.string().max(2000).optional(),
    acaminho: z.string().max(2000).optional(),
    pagamentolink: z.string().max(2000).optional(),
    pagamentolembrete: z.string().max(2000).optional(),
    pagamentoconfirmado: z.string().max(2000).optional(),
    agendamentofollowup: z.string().max(2000).optional(),
    agendamentocancelado: z.string().max(2000).optional(),
  })
  const parsed = msgSchema.safeParse({
    cadastro: formData.get("autoCadastroMsg"),
    cadastro2: formData.get("autoCadastroFollowUp2Msg"),
    cadastro3: formData.get("autoCadastroFollowUp3Msg"),
    tratamento: formData.get("autoTratamentoMsg"),
    aniversario: formData.get("autoAniversarioMsg"),
    reativacao: formData.get("autoReativacaoMsg"),
    agradecimento: formData.get("autoAgradecimentoMsg"),
    acaminho: formData.get("autoACaminhoMsg"),
    pagamentolink: formData.get("autoPagamentoLinkMsg"),
    pagamentolembrete: formData.get("autoPagamentoLembreteMsg"),
    pagamentoconfirmado: formData.get("autoPagamentoConfirmadoMsg"),
    agendamentofollowup: formData.get("autoAgendamentoFollowUpMsg"),
    agendamentocancelado: formData.get("autoAgendamentoCanceladoMsg"),
  })
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }

  const data = parsed.data
  const fields = {
    autoCadastroEnabled: flag(formData, "autoCadastroEnabled"),
    autoCadastroMsg: data.cadastro?.trim() || null,
    autoCadastroFollowUp2Msg: data.cadastro2?.trim() || null,
    autoCadastroFollowUp3Msg: data.cadastro3?.trim() || null,
    autoTratamentoEnabled: flag(formData, "autoTratamentoEnabled"),
    autoTratamentoIntervalDays: intField(
      formData,
      "autoTratamentoIntervalDays",
      7
    ),
    autoTratamentoMsg: data.tratamento?.trim() || null,
    autoAniversarioEnabled: flag(formData, "autoAniversarioEnabled"),
    autoAniversarioMsg: data.aniversario?.trim() || null,
    autoReativacaoEnabled: flag(formData, "autoReativacaoEnabled"),
    autoReativacaoDays: intField(formData, "autoReativacaoDays", 60),
    autoReativacaoMsg: data.reativacao?.trim() || null,
    autoAgradecimentoEnabled: flag(formData, "autoAgradecimentoEnabled"),
    autoAgradecimentoMsg: data.agradecimento?.trim() || null,
    autoACaminhoEnabled: flag(formData, "autoACaminhoEnabled"),
    autoACaminhoMsg: data.acaminho?.trim() || null,
    autoPagamentoLinkEnabled: flag(formData, "autoPagamentoLinkEnabled"),
    autoPagamentoLinkMsg: data.pagamentolink?.trim() || null,
    autoPagamentoLembreteEnabled: flag(
      formData,
      "autoPagamentoLembreteEnabled"
    ),
    autoPagamentoLembreteDelayMinutes: intField(
      formData,
      "autoPagamentoLembreteDelayMinutes",
      60
    ),
    autoPagamentoLembreteMsg: data.pagamentolembrete?.trim() || null,
    autoPagamentoConfirmadoEnabled: flag(
      formData,
      "autoPagamentoConfirmadoEnabled"
    ),
    autoPagamentoConfirmadoMsg: data.pagamentoconfirmado?.trim() || null,
    autoAgendamentoFollowUpEnabled: flag(
      formData,
      "autoAgendamentoFollowUpEnabled"
    ),
    autoAgendamentoFollowUpMsg: data.agendamentofollowup?.trim() || null,
    autoAgendamentoCanceladoMsg: data.agendamentocancelado?.trim() || null,
  }

  await prisma.clinicSettings.upsert({
    where: { id: 1 },
    update: fields,
    create: { id: 1, ...fields },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "ClinicSettings",
      entityId: "automacoes",
    },
  })

  revalidatePath("/", "layout")
  return { success: true, message: "Automações salvas" }
}
