"use server"

/**
 * Ações do painel de fluxos (MessageFlow) — só ADMIN.
 *
 * - saveFlow: valida e grava o grafo inteiro (nodes/edges JSON) numa
 *   escrita atômica. Substitui lib/actions/journeys.ts.
 * - deleteFlow/toggleFlowEnabled: gestão de fluxos (BOT não é excluível).
 * - startJourneyForPatient: dispara um fluxo JORNADA para um paciente,
 *   enfileirando as MENSAGEMs com os atrasos acumulados das arestas.
 */
import { revalidatePath } from "next/cache"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { getClinicSettings } from "@/lib/clinic"
import { isPhonePaused } from "@/lib/whatsapp/bot-pause"
import {
  flowMessageChain,
  type FlowNode,
} from "@/lib/whatsapp/flow-types"

export type ActionState = { success: boolean; message: string }

/** Máximo de atraso por aresta: 30 dias, em minutos. */
const MAX_DELAY_MINUTES = 30 * 24 * 60

const GATILHOS = [
  "mensagem_recebida",
  "inicio_manual",
  "cadastro_incompleto",
  "whatsapp_contato",
  "tratamento_periodico",
  "aniversario",
  "reativacao",
  "agradecimento",
  "acaminho",
  "link_pagamento",
  "lembrete_pagamento",
  "pagamento_confirmado",
  "agendamento_followup",
  "agendamento_cancelado",
] as const

const ACOES = [
  "PEDIR_CPF",
  "CONSULTAR_CONSULTAS",
  "AVISAR_EQUIPE",
  "HORARIO",
  "VALORES",
  "ENDERECO",
  "CONTATO",
] as const

const nodeSchema = z
  .object({
    id: z.string().min(1, "Nó sem id").max(80),
    kind: z.enum(["GATILHO", "MENSAGEM", "PEDIR_NOME", "PORTAO", "RAMO", "ACAO"]),
    position: z.object({
      x: z.number(),
      y: z.number(),
    }),
    gatilho: z.enum(GATILHOS).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    content: z.string().optional(),
    mediaUrl: z.string().nullable().optional(),
    mediaType: z.enum(["IMAGEM", "VIDEO"]).nullable().optional(),
    showOptions: z.boolean().optional(),
    label: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    optionNumber: z.number().int().min(1).max(9).nullable().optional(),
    acao: z.enum(ACOES).optional(),
    intro: z.string().optional(),
  })
  .passthrough()

const edgeSchema = z.object({
  id: z.string().min(1, "Aresta sem id").max(80),
  source: z.string().min(1),
  target: z.string().min(1),
  delayMinutes: z.number().optional(),
})

function requireAdmin() {
  return auth().then((session) => {
    if (!session?.user || session.user.role !== "ADMIN") {
      return { session, error: "Apenas administradores podem gerenciar fluxos" }
    }
    return { session, error: null }
  })
}

/**
 * Valida e sanitiza o grafo enviado pelo canvas. Retorna { nodes, edges }
 * prontos para salvar ou { error } com a mensagem para o usuário.
 */
function parseFlowJson(rawNodes: unknown, rawEdges: unknown): {
  nodes?: FlowNode[]
  edges?: Array<{ id: string; source: string; target: string; delayMinutes?: number }>
  error?: string
} {
  const nodes = Array.isArray(rawNodes) ? rawNodes : null
  const edges = Array.isArray(rawEdges) ? rawEdges : null
  if (!nodes || !edges) {
    return { error: "Grafo inválido (nodes/edges ausentes)" }
  }

  const parsedNodes: FlowNode[] = []
  for (const [index, raw] of nodes.entries()) {
    const parsed = nodeSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        error: `Nó ${index + 1}: ${parsed.error.issues[0]?.message ?? "inválido"}`,
      }
    }
    const node = parsed.data
    const clean = {
      id: node.id,
      kind: node.kind,
      position: { x: node.position.x, y: node.position.y },
      ...(node.kind === "GATILHO" ? {
        gatilho: node.gatilho ?? "inicio_manual",
        config: node.config ?? {},
      } : {}),
      ...(node.kind === "MENSAGEM" ? {
        content: (node.content ?? "").trim(),
        mediaUrl: node.mediaUrl ?? null,
        mediaType: node.mediaUrl ? (node.mediaType ?? null) : null,
        showOptions: node.showOptions === true,
      } : {}),
      ...(node.kind === "PEDIR_NOME" || node.kind === "PORTAO" ? {
        content: (node.content ?? "").trim(),
      } : {}),
      ...(node.kind === "RAMO" ? {
        label: (node.label ?? "").trim() || "Ramo",
        keywords: (node.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean),
        optionNumber: node.optionNumber ?? null,
      } : {}),
      ...(node.kind === "ACAO" ? {
        acao: node.acao ?? "PEDIR_CPF",
        intro: node.intro?.trim() || undefined,
      } : {}),
    } as FlowNode
    if (node.kind === "MENSAGEM" && !(node.content ?? "").trim()) {
      return { error: `Nó ${index + 1}: escreva o texto da mensagem` }
    }
    if (
      (node.kind === "PEDIR_NOME" || node.kind === "PORTAO") &&
      !(node.content ?? "").trim()
    ) {
      return { error: `Nó ${index + 1}: escreva o texto do nó` }
    }
    if (node.kind === "MENSAGEM" && node.mediaUrl && !/^https:\/\//.test(node.mediaUrl)) {
      return { error: `Nó ${index + 1}: URL da mídia inválida` }
    }
    parsedNodes.push(clean)
  }

  if (!parsedNodes.some((n) => n.kind === "GATILHO")) {
    return { error: "O fluxo precisa de um nó de gatilho" }
  }

  const ids = new Set(parsedNodes.map((n) => n.id))
  const parsedEdges: Array<{ id: string; source: string; target: string; delayMinutes?: number }> = []
  for (const [index, raw] of edges.entries()) {
    const parsed = edgeSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        error: `Aresta ${index + 1}: ${parsed.error.issues[0]?.message ?? "inválida"}`,
      }
    }
    if (!ids.has(parsed.data.source) || !ids.has(parsed.data.target)) {
      return { error: `Aresta ${index + 1}: conecta um nó inexistente` }
    }
    const delay = parsed.data.delayMinutes
    if (delay !== undefined && (delay < 0 || delay > MAX_DELAY_MINUTES)) {
      return { error: `Aresta ${index + 1}: atraso deve ficar entre 0 e 30 dias` }
    }
    parsedEdges.push({
      id: parsed.data.id,
      source: parsed.data.source,
      target: parsed.data.target,
      ...(delay !== undefined ? { delayMinutes: Math.round(delay) } : {}),
    })
  }

  return { nodes: parsedNodes, edges: parsedEdges }
}

/**
 * Cria/atualiza um fluxo com o grafo inteiro (escrita atômica).
 * O canvas envia kind/nodes/edges no FormData; atualizações mantêm o kind
 * do registro existente.
 */
export async function saveFlow(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const { error } = await requireAdmin()
  if (error) return { success: false, message: error }

  const flowId = formData.get("flowId")?.toString() ?? ""
  const name = formData.get("name")?.toString()?.trim() ?? ""
  const description = formData.get("description")?.toString()?.trim() ?? ""
  const kind = formData.get("kind")?.toString() ?? ""

  if (name.length < 3) {
    return { success: false, message: "Dê um nome ao fluxo (mín. 3 letras)" }
  }

  let rawNodes: unknown
  let rawEdges: unknown
  try {
    rawNodes = JSON.parse(formData.get("nodes")?.toString() ?? "[]")
    rawEdges = JSON.parse(formData.get("edges")?.toString() ?? "[]")
  } catch {
    return { success: false, message: "Grafo inválido (JSON corrompido)" }
  }

  const graph = parseFlowJson(rawNodes, rawEdges)
  if (graph.error || !graph.nodes || !graph.edges) {
    return { success: false, message: graph.error ?? "Grafo inválido" }
  }

  if (flowId) {
    const existing = await prisma.messageFlow.findUnique({
      where: { id: flowId },
      select: { id: true, kind: true },
    })
    if (!existing) {
      return { success: false, message: "Fluxo não encontrado" }
    }
    await prisma.messageFlow.update({
      where: { id: flowId },
      data: {
        name,
        description: description || null,
        nodes: graph.nodes as unknown as Prisma.InputJsonValue,
        edges: graph.edges as unknown as Prisma.InputJsonValue,
      },
    })
  } else {
    if (kind === "BOT") {
      return {
        success: false,
        message: "O fluxo do bot é único e não pode ser criado manualmente",
      }
    }
    if (kind !== "AUTOMACAO" && kind !== "JORNADA") {
      return { success: false, message: "Tipo de fluxo inválido para criação" }
    }
    await prisma.messageFlow.create({
      data: {
        kind,
        name,
        description: description || null,
        enabled: true,
        nodes: graph.nodes as unknown as Prisma.InputJsonValue,
        edges: graph.edges as unknown as Prisma.InputJsonValue,
      },
    })
  }

  revalidatePath("/automacoes")
  revalidatePath("/whatsapp")
  return {
    success: true,
    message: flowId ? "Fluxo atualizado" : "Fluxo criado",
  }
}

/** Exclui um fluxo (o fluxo BOT é fixo e não pode ser excluído). */
export async function deleteFlow(id: string): Promise<ActionState> {
  const { error } = await requireAdmin()
  if (error) return { success: false, message: error }

  const flow = await prisma.messageFlow.findUnique({
    where: { id },
    select: { kind: true },
  })
  if (!flow) return { success: false, message: "Fluxo não encontrado" }
  if (flow.kind === "BOT") {
    return { success: false, message: "O fluxo do bot não pode ser excluído" }
  }

  await prisma.messageFlow.delete({ where: { id } })
  revalidatePath("/automacoes")
  revalidatePath("/whatsapp")
  return { success: true, message: "Fluxo excluído" }
}

/** Ativa/desativa um fluxo (desligado = gatilho não dispara). */
export async function toggleFlowEnabled(id: string): Promise<ActionState> {
  const { error } = await requireAdmin()
  if (error) return { success: false, message: error }

  const flow = await prisma.messageFlow.findUnique({
    where: { id },
    select: { enabled: true },
  })
  if (!flow) return { success: false, message: "Fluxo não encontrado" }

  await prisma.messageFlow.update({
    where: { id },
    data: { enabled: !flow.enabled },
  })
  revalidatePath("/automacoes")
  revalidatePath("/whatsapp")
  return {
    success: true,
    message: flow.enabled ? "Fluxo desativado" : "Fluxo ativado",
  }
}

/**
 * Inicia um fluxo JORNADA para um paciente: valida LGPD/telefone/WhatsApp e
 * enfileira as MENSAGEMs com os atrasos acumulados das arestas. Passos
 * futuros respeitam a pausa do bot (se a equipe assumir a conversa, os
 * próximos passos são suprimidos pelo envio da fila).
 */
export async function startJourneyForPatient(
  patientId: string,
  flowId: string
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user || !["ADMIN", "SECRETARIA"].includes(session.user.role)) {
    return { success: false, message: "Sem permissão para iniciar jornadas" }
  }

  if (!patientId || !flowId) {
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

  const flow = await prisma.messageFlow.findUnique({ where: { id: flowId } })
  if (!flow || flow.kind !== "JORNADA" || !flow.enabled) {
    return { success: false, message: "Jornada não encontrada" }
  }

  const chain = flowMessageChain({
    id: flow.id,
    kind: flow.kind,
    name: flow.name,
    description: flow.description,
    enabled: flow.enabled,
    nodes: (flow.nodes as unknown as FlowNode[]),
    edges: (flow.edges as unknown as Array<{ id: string; source: string; target: string; delayMinutes?: number }>),
  })
  if (chain.length === 0) {
    return { success: false, message: "A jornada não tem mensagens" }
  }

  // Atendimento humano em andamento: não inicia a jornada.
  if (await isPhonePaused(patient.phone)) {
    return {
      success: false,
      message:
        "Bot pausado para este paciente (atendimento humano) — a jornada não foi iniciada",
    }
  }

  const now = new Date()
  const rows = chain.map(({ node, dueMinutes }) => ({
    patientId,
    type: "JORNADA" as const,
    direction: "OUT" as const,
    content: node.content,
    status: "PENDENTE" as const,
    scheduledFor: new Date(now.getTime() + dueMinutes * 60 * 1000),
    mediaUrl: node.mediaUrl ?? null,
    mediaType: node.mediaUrl
      ? (node.mediaType === "VIDEO" ? "VIDEO" : "IMAGEM")
      : null,
  }))

  await prisma.message.createMany({ data: rows })

  revalidatePath("/whatsapp")
  const clinic = await getClinicSettings()
  const hours = clinic.botPauseHours ?? 24
  return {
    success: true,
    message: `Jornada iniciada (${rows.length} mensagem${rows.length > 1 ? "s" : ""} na fila). Se a equipe assumir a conversa, os próximos passos são suprimidos até o bot voltar (${hours}h)`,
  }
}
