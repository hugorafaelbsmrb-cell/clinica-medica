"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { getClinicSettings } from "@/lib/clinic"
import { enqueueJourneyForPatient } from "@/lib/whatsapp/message-service"

export type ActionState = { success: boolean; message: string }

const stepSchema = z.object({
  kind: z.enum(["TEXTO", "IMAGEM", "VIDEO"]),
  content: z.string(),
  mediaUrl: z.string().optional().nullable(),
  // Tempo após o passo anterior, em horas (a UI converte dias × 24).
  delayHours: z.coerce.number().min(0, "Tempo não pode ser negativo").max(720, "Máximo de 30 dias por passo"),
})

function requireAdmin() {
  return auth().then((session) => {
    if (!session?.user || session.user.role !== "ADMIN") {
      return { session, error: "Apenas administradores podem gerenciar jornadas" }
    }
    return { session, error: null }
  })
}

/**
 * Cria/atualiza uma jornada com os passos enviados como JSON
 * (`[{ kind, content, mediaUrl, delayHours }]`, ordem pelo array).
 * Na atualização a lista de passos é substituída inteira.
 */
export async function saveJourney(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const { error } = await requireAdmin()
  if (error) return { success: false, message: error }

  const journeyId = formData.get("journeyId")?.toString() ?? ""
  const name = formData.get("name")?.toString()?.trim() ?? ""
  const description = formData.get("description")?.toString()?.trim() ?? ""

  if (name.length < 3) {
    return { success: false, message: "Dê um nome à jornada (mín. 3 letras)" }
  }

  let rawSteps: unknown
  try {
    rawSteps = JSON.parse(formData.get("steps")?.toString() ?? "[]")
  } catch {
    return { success: false, message: "Passos da jornada inválidos" }
  }
  if (!Array.isArray(rawSteps)) {
    return { success: false, message: "Passos da jornada inválidos" }
  }

  const steps: Array<{
    position: number
    kind: "TEXTO" | "IMAGEM" | "VIDEO"
    content: string
    mediaUrl: string | null
    delayHours: number
  }> = []
  for (const [index, raw] of rawSteps.entries()) {
    const parsed = stepSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        success: false,
        message: `Passo ${index + 1}: ${parsed.error.issues[0]?.message ?? "inválido"}`,
      }
    }
    const step = parsed.data
    if (step.kind === "TEXTO" && !step.content.trim()) {
      return {
        success: false,
        message: `Passo ${index + 1}: escreva o texto da mensagem`,
      }
    }
    if (step.kind !== "TEXTO" && !step.mediaUrl) {
      return {
        success: false,
        message: `Passo ${index + 1}: selecione a ${step.kind === "IMAGEM" ? "imagem" : "vídeo"}`,
      }
    }
    if (step.mediaUrl && !/^https:\/\//.test(step.mediaUrl)) {
      return {
        success: false,
        message: `Passo ${index + 1}: URL da mídia inválida`,
      }
    }
    steps.push({
      position: index,
      kind: step.kind,
      content: step.content.trim(),
      mediaUrl: step.kind !== "TEXTO" ? (step.mediaUrl ?? null) : null,
      delayHours: Math.round(step.delayHours),
    })
  }

  if (steps.length === 0) {
    return { success: false, message: "Adicione ao menos um passo à jornada" }
  }

  const data = {
    name,
    description: description || null,
    active: formData.get("active") === "on",
  }

  if (journeyId) {
    const existing = await prisma.messageJourney.findUnique({
      where: { id: journeyId },
      select: { id: true },
    })
    if (!existing) {
      return { success: false, message: "Jornada não encontrada" }
    }
    await prisma.$transaction([
      prisma.messageJourney.update({ where: { id: journeyId }, data }),
      prisma.journeyStep.deleteMany({ where: { journeyId } }),
      prisma.journeyStep.createMany({
        data: steps.map((step) => ({ ...step, journeyId })),
      }),
    ])
  } else {
    await prisma.messageJourney.create({
      data: {
        ...data,
        steps: { createMany: { data: steps } },
      },
    })
  }

  revalidatePath("/automacoes")
  return { success: true, message: journeyId ? "Jornada atualizada" : "Jornada criada" }
}

/** Exclui uma jornada (e seus passos, via cascade). */
export async function deleteJourney(id: string): Promise<ActionState> {
  const { error } = await requireAdmin()
  if (error) return { success: false, message: error }

  await prisma.messageJourney.delete({ where: { id } }).catch(() => null)
  revalidatePath("/automacoes")
  return { success: true, message: "Jornada excluída" }
}

/** Ativa/desativa uma jornada (desativada não aparece para disparo). */
export async function toggleJourneyActive(id: string): Promise<ActionState> {
  const { error } = await requireAdmin()
  if (error) return { success: false, message: error }

  const journey = await prisma.messageJourney.findUnique({
    where: { id },
    select: { active: true },
  })
  if (!journey) return { success: false, message: "Jornada não encontrada" }

  await prisma.messageJourney.update({
    where: { id },
    data: { active: !journey.active },
  })
  revalidatePath("/automacoes")
  revalidatePath("/whatsapp")
  return {
    success: true,
    message: journey.active ? "Jornada desativada" : "Jornada ativada",
  }
}

/**
 * Inicia uma jornada para um paciente: valida LGPD/telefone/WhatsApp e
 * enfileira os passos com seus atrasos. Passos futuros respeitam a pausa
 * do bot (se a equipe assumir a conversa, os próximos passos são
 * suprimidos).
 */
export async function startJourneyForPatient(
  patientId: string,
  journeyId: string
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user || !["ADMIN", "SECRETARIA"].includes(session.user.role)) {
    return { success: false, message: "Sem permissão para iniciar jornadas" }
  }

  if (!patientId || !journeyId) {
    return { success: false, message: "Selecione o paciente e a jornada" }
  }

  const patient = await prisma.patient.findUnique({ where: { id: patientId } })
  if (!patient) return { success: false, message: "Paciente não encontrado" }
  if (!patient.lgpdConsent) {
    return {
      success: false,
      message: "Paciente sem consentimento LGPD para contato",
    }
  }
  if (!patient.whatsappEnabled) {
    return { success: false, message: "Paciente sem WhatsApp habilitado" }
  }
  if (!patient.phone) {
    return { success: false, message: "Paciente sem telefone cadastrado" }
  }

  const queued = await enqueueJourneyForPatient(patientId, journeyId)
  if (queued === null) {
    return {
      success: false,
      message:
        "Bot pausado para este paciente (atendimento humano) — a jornada não foi iniciada",
    }
  }

  revalidatePath("/whatsapp")
  const clinic = await getClinicSettings()
  const hours = clinic.botPauseHours ?? 24
  return {
    success: true,
    message: `Jornada iniciada (${queued} mensagem${queued > 1 ? "s" : ""} na fila). Se a equipe assumir a conversa, os próximos passos são suprimidos até o bot voltar (${hours}h)`,
  }
}
