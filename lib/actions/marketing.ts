"use server"

/**
 * Ações da tela /marketing (só ADMIN): criar, editar e cancelar campanhas
 * de mensagem em massa. Cada ação registra auditoria (AuditLog).
 */
import { z } from "zod"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isAIEnabled } from "@/lib/ai/provider"
import { generateMarketingMessage as generateMarketingMessageWithAI } from "@/lib/ai/marketing-message"
import {
  countMarketingAudience,
  type MarketingAudience,
  type MarketingAudienceKind,
} from "@/lib/marketing/service"

export type MarketingActionState = {
  success: boolean
  message: string
  campaignId?: string
}

const TONES = ["informativo", "promocional", "sazonal", "evento"] as const
const AUDIENCE_KINDS = ["TODOS", "MEDICO", "ATIVOS"] as const

/** Limite da imagem enviada com a campanha (mesma convenção da logo). */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024

const campaignSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome para a campanha"),
  tone: z.enum(TONES),
  body: z.string().trim().min(1, "Escreva a mensagem da campanha"),
  linkUrl: z
    .union([z.string().trim().url("Link inválido — use uma URL https"), z.literal("")])
    .optional(),
  imageDataUrl: z.string().optional(),
  scheduledAt: z.string().min(1, "Informe a data e hora do envio"),
  audienceKind: z.enum(AUDIENCE_KINDS),
  audienceDoctorId: z.string().optional(),
  audienceDays: z.string().optional(),
  asDraft: z.string().optional(), // "on" = salvar como rascunho
})

/** Valida a imagem (data URL PNG/JPEG até 2 MB). */
function parseImage(
  raw: string | undefined
): { imageDataUrl: string | null; error?: string } {
  if (!raw) return { imageDataUrl: null }

  if (!/^data:image\/(png|jpe?g);base64,/.test(raw)) {
    return { imageDataUrl: null, error: "Imagem inválida — use PNG ou JPEG" }
  }

  const base64 = raw.split(",")[1] ?? ""
  const sizeBytes = Math.ceil((base64.length * 3) / 4)
  if (sizeBytes > MAX_IMAGE_BYTES) {
    return { imageDataUrl: null, error: "Imagem muito grande — use até 2 MB" }
  }

  return { imageDataUrl: raw }
}

/** Valida a audiência (médico ativo ou dias válidos conforme o tipo). */
async function parseAudience(input: {
  kind: MarketingAudienceKind
  doctorId?: string
  days?: string
}): Promise<{ audience: MarketingAudience | null; error?: string }> {
  if (input.kind === "MEDICO") {
    const doctorId = input.doctorId?.trim()
    if (!doctorId) {
      return { audience: null, error: "Selecione o médico da audiência" }
    }
    const doctor = await prisma.user.findFirst({
      where: { id: doctorId, role: "MEDICO", active: true },
      select: { id: true },
    })
    if (!doctor) {
      return { audience: null, error: "Médico da audiência inválido" }
    }
    return { audience: { kind: "MEDICO", doctorId: doctor.id } }
  }

  if (input.kind === "ATIVOS") {
    const days = Number(input.days ?? "")
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      return {
        audience: null,
        error: "Informe um período válido em dias (1 a 3650)",
      }
    }
    return { audience: { kind: "ATIVOS", days } }
  }

  return { audience: { kind: "TODOS" } }
}

/** Campos comuns do formulário → dados da campanha validados. */
async function parseCampaignForm(
  formData: FormData,
  requireFuture: boolean
): Promise<
  | {
      success: false
      message: string
    }
  | {
      success: true
      data: {
        name: string
        tone: string
        body: string
        linkUrl: string | null
        imageDataUrl: string | null
        scheduledFor: Date
        status: "RASCUNHO" | "AGENDADA"
        audience: MarketingAudience
      }
    }
> {
  const parsed = campaignSchema.safeParse({
    name: formData.get("name"),
    tone: formData.get("tone"),
    body: formData.get("body"),
    linkUrl: formData.get("linkUrl") || "",
    imageDataUrl: formData.get("imageDataUrl") || undefined,
    scheduledAt: formData.get("scheduledAt"),
    audienceKind: formData.get("audienceKind"),
    audienceDoctorId: formData.get("audienceDoctorId") || undefined,
    audienceDays: formData.get("audienceDays") || undefined,
    asDraft: formData.get("asDraft") || undefined,
  })
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }
  const data = parsed.data

  const image = parseImage(data.imageDataUrl)
  if (image.error) return { success: false, message: image.error }

  const parsedAudience = await parseAudience({
    kind: data.audienceKind,
    doctorId: data.audienceDoctorId,
    days: data.audienceDays,
  })
  if (parsedAudience.error) {
    return { success: false, message: parsedAudience.error }
  }
  if (!parsedAudience.audience) {
    return { success: false, message: "Audiência inválida" }
  }

  // Rascunho não tem hora de envio; senão a data precisa ser futura.
  const asDraft = data.asDraft === "on"
  const scheduledFor = asDraft
    ? new Date()
    : new Date(data.scheduledAt)
  if (!asDraft && Number.isNaN(scheduledFor.getTime())) {
    return { success: false, message: "Data e hora do envio inválidas" }
  }
  if (requireFuture && !asDraft && scheduledFor.getTime() <= Date.now()) {
    return {
      success: false,
      message: "Agende o envio para um horário futuro",
    }
  }

  return {
    success: true,
    data: {
      name: data.name,
      tone: data.tone,
      body: data.body,
      linkUrl: data.linkUrl || null,
      imageDataUrl: image.imageDataUrl,
      scheduledFor,
      status: asDraft ? "RASCUNHO" : "AGENDADA",
      audience: parsedAudience.audience,
    },
  }
}

export async function createMarketingCampaign(
  _prev: MarketingActionState | null,
  formData: FormData
): Promise<MarketingActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  if (session.user.role !== "ADMIN") {
    return { success: false, message: "Apenas administradores podem criar campanhas" }
  }

  const parsedForm = await parseCampaignForm(formData, true)
  if (!parsedForm.success) {
    return { success: false, message: parsedForm.message }
  }
  const data = parsedForm.data

  const campaign = await prisma.marketingCampaign.create({
    data: {
      name: data.name,
      tone: data.tone,
      body: data.body,
      linkUrl: data.linkUrl,
      imageDataUrl: data.imageDataUrl,
      scheduledFor: data.scheduledFor,
      status: data.status,
      audience: data.audience as unknown as object,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CREATE",
      entity: "MarketingCampaign",
      entityId: campaign.id,
      details: { name: campaign.name, status: campaign.status },
    },
  })

  revalidatePath("/marketing")
  return {
    success: true,
    message:
      data.status === "RASCUNHO"
        ? "Campanha salva como rascunho"
        : "Campanha agendada — o envio começa no horário definido",
    campaignId: campaign.id,
  }
}

export async function updateMarketingCampaign(
  _prev: MarketingActionState | null,
  formData: FormData
): Promise<MarketingActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  if (session.user.role !== "ADMIN") {
    return { success: false, message: "Apenas administradores podem editar campanhas" }
  }

  const id = String(formData.get("id") ?? "").trim()
  if (!id) return { success: false, message: "Campanha não identificada" }

  const existing = await prisma.marketingCampaign.findUnique({
    where: { id },
    select: { status: true },
  })
  if (!existing) return { success: false, message: "Campanha não encontrada" }
  if (existing.status !== "RASCUNHO" && existing.status !== "AGENDADA") {
    return {
      success: false,
      message: "Só é possível editar campanhas em rascunho ou agendadas",
    }
  }

  const parsedForm = await parseCampaignForm(formData, true)
  if (!parsedForm.success) {
    return { success: false, message: parsedForm.message }
  }
  const data = parsedForm.data

  const campaign = await prisma.marketingCampaign.update({
    where: { id },
    data: {
      name: data.name,
      tone: data.tone,
      body: data.body,
      linkUrl: data.linkUrl,
      imageDataUrl: data.imageDataUrl,
      scheduledFor: data.scheduledFor,
      status: data.status,
      audience: data.audience as unknown as object,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "MarketingCampaign",
      entityId: campaign.id,
      details: { name: campaign.name, status: campaign.status },
    },
  })

  revalidatePath("/marketing")
  return {
    success: true,
    message:
      data.status === "RASCUNHO"
        ? "Campanha atualizada (rascunho)"
        : "Campanha atualizada e reagendada",
    campaignId: campaign.id,
  }
}

export async function cancelMarketingCampaign(
  id: string
): Promise<MarketingActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  if (session.user.role !== "ADMIN") {
    return { success: false, message: "Apenas administradores podem cancelar campanhas" }
  }

  const campaignId = id.trim()
  if (!campaignId) return { success: false, message: "Campanha não identificada" }

  const existing = await prisma.marketingCampaign.findUnique({
    where: { id: campaignId },
    select: { name: true, status: true },
  })
  if (!existing) return { success: false, message: "Campanha não encontrada" }
  if (
    existing.status !== "RASCUNHO" &&
    existing.status !== "AGENDADA" &&
    existing.status !== "ENVIANDO"
  ) {
    return { success: false, message: "Campanha não pode mais ser cancelada" }
  }

  await prisma.marketingCampaign.update({
    where: { id: campaignId },
    data: { status: "CANCELADA" },
  })

  // Mensagens ainda na fila não serão enviadas (o worker também protege).
  await prisma.message.updateMany({
    where: { marketingCampaignId: campaignId, status: "PENDENTE" },
    data: { status: "FALHA", error: "Campanha cancelada" },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CANCEL",
      entity: "MarketingCampaign",
      entityId: campaignId,
      details: { name: existing.name },
    },
  })

  revalidatePath("/marketing")
  return { success: true, message: "Campanha cancelada" }
}

/** Prévia da audiência (chamada pelo formulário ao trocar os filtros). */
export async function previewMarketingAudience(input: {
  kind?: string
  doctorId?: string | null
  days?: number | null
}): Promise<{ ok: boolean; count?: number; message?: string }> {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return { ok: false, message: "Sem permissão" }
  }

  const kind: MarketingAudienceKind =
    input.kind === "MEDICO" || input.kind === "ATIVOS" ? input.kind : "TODOS"

  const parsedAudience = await parseAudience({
    kind,
    doctorId: input.doctorId ?? undefined,
    days: input.days != null ? String(input.days) : undefined,
  })
  if (!parsedAudience.audience) {
    return { ok: false, message: parsedAudience.error ?? "Audiência inválida" }
  }

  const count = await countMarketingAudience(parsedAudience.audience)
  return { ok: true, count }
}

/**
 * Gera a mensagem da campanha com IA (DeepSeek) a partir do tema, sem salvar
 * nada: o texto volta para o formulário, e o admin revisa antes de agendar.
 * Sem chave da DeepSeek, retorna erro amigável e o fluxo manual continua.
 */
export async function generateMarketingMessage(input: {
  tone?: string
  topic?: string
  linkUrl?: string | null
  currentMessage?: string | null
}): Promise<{ success: boolean; message: string; content?: string }> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  if (session.user.role !== "ADMIN") {
    return {
      success: false,
      message: "Apenas administradores podem usar a IA nas campanhas",
    }
  }

  if (!(await isAIEnabled())) {
    return {
      success: false,
      message:
        "IA não configurada. Adicione a chave da DeepSeek em Configurações → Integrações.",
    }
  }

  const tone = TONES.includes(input.tone as (typeof TONES)[number])
    ? (input.tone as (typeof TONES)[number])
    : "informativo"
  const topic = input.topic?.trim() ?? ""
  if (topic.length < 3) {
    return { success: false, message: "Descreva o tema da mensagem antes de gerar" }
  }
  if (topic.length > 500) {
    return { success: false, message: "Tema muito longo — resuma em até 500 caracteres" }
  }

  const result = await generateMarketingMessageWithAI({
    tone,
    topic,
    linkUrl: input.linkUrl?.trim() || null,
    currentMessage: input.currentMessage?.trim() || null,
  })

  if (!result.ok || !result.content) {
    return { success: false, message: result.error ?? "Falha na geração com IA" }
  }

  return { success: true, message: "Mensagem gerada com IA", content: result.content }
}
