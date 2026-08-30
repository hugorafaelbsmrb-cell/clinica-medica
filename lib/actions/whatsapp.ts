"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { getClinicSettings } from "@/lib/clinic"
import { sendManualMessage } from "@/lib/whatsapp/message-service"

export type ActionState = { success: boolean; message: string }

export async function sendMessageAction(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }

  const patientId = formData.get("patientId")?.toString() ?? ""
  const content = formData.get("content")?.toString() ?? ""

  if (!patientId) return { success: false, message: "Selecione o paciente" }
  if (content.trim().length < 2) {
    return { success: false, message: "Escreva a mensagem" }
  }

  const result = await sendManualMessage(patientId, content.trim())
  if (result.ok) {
    revalidatePath("/whatsapp")
    // A equipe assumiu a conversa: avisa que o bot ficará em silêncio
    // para este paciente até o prazo configurado vencer.
    const clinic = await getClinicSettings()
    const hours = clinic.botPauseHours ?? 24
    return {
      success: true,
      message: `Mensagem enfileirada — bot pausado para este paciente por ${hours}h`,
    }
  }
  return { success: result.ok, message: result.message }
}

const templateSchema = z.object({
  name: z.string().min(3, "Nome muito curto"),
  type: z.enum(["PRIMEIRO_CONTATO", "ACOMPANHAMENTO"]),
  body: z.string().min(10, "Corpo muito curto"),
})

export async function createTemplateAction(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }

  const parsed = templateSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    body: formData.get("body"),
  })

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }

  await prisma.messageTemplate.create({ data: parsed.data })
  revalidatePath("/whatsapp")
  return { success: true, message: "Template criado" }
}

export async function toggleFollowUpAction(
  patientId: string,
  intervalDays: number
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }

  const existing = await prisma.followUpConfig.findUnique({
    where: { patientId },
  })

  if (existing) {
    await prisma.followUpConfig.update({
      where: { id: existing.id },
      data: { active: !existing.active, intervalDays },
    })
  } else {
    await prisma.followUpConfig.create({
      data: {
        patientId,
        active: true,
        intervalDays,
        nextDueAt: new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000),
      },
    })
  }

  revalidatePath("/whatsapp")
  return { success: true, message: "Acompanhamento atualizado" }
}
