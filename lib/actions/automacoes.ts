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
    tratamento: z.string().max(2000).optional(),
    aniversario: z.string().max(2000).optional(),
    reativacao: z.string().max(2000).optional(),
    agradecimento: z.string().max(2000).optional(),
  })
  const parsed = msgSchema.safeParse({
    cadastro: formData.get("autoCadastroMsg"),
    tratamento: formData.get("autoTratamentoMsg"),
    aniversario: formData.get("autoAniversarioMsg"),
    reativacao: formData.get("autoReativacaoMsg"),
    agradecimento: formData.get("autoAgradecimentoMsg"),
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
    autoCadastroDelayHours: intField(formData, "autoCadastroDelayHours", 24),
    autoCadastroMsg: data.cadastro?.trim() || null,
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
