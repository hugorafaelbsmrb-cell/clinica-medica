/**
 * Motor do fluxo BOT (grafo orientado a dados, estilo n8n).
 *
 * Avalia o grafo salvo na tabela MessageFlow (kind BOT) a partir do hub
 * inicial: casa os RAMOs filhos por opção numerada, palavra-chave ou
 * fallback e percorre a cadeia de resposta executando MENSAGEM e ACAO.
 *
 * A máquina de estados da sessão (MENU/AGUARDANDO_CPF) continua aqui, no
 * motor: o conteúdo vem do grafo, a mecânica de CPF fica no engine (igual
 * ao comportamento histórico do bot).
 */
import type { FlowNode, FlowRecord } from "./flow-types"
import {
  childrenOf,
  findNode,
  outgoingEdges,
  rootNodeId,
  walkChain,
} from "./flow-types"

export type BotState =
  | "MENU"
  | "AGUARDANDO_CPF"
  | "AGUARDANDO_NOME"
  | "AGUARDANDO_TIPO"

export type BotFlowContext = {
  clinicName: string
  address?: string | null
  phone?: string | null
  email?: string | null
  horarioAtendimento?: string | null
  baseUrl: string
}

export type BotFlowResult = {
  reply: string
  nextState: BotState
  needsAttention: boolean
  /** CPF extraído da mensagem: o serviço busca as consultas e monta a resposta. */
  cpfLookup?: string
  /** Mídia do nó MENSAGEM casado (envio de imagem/vídeo no lugar do texto). */
  mediaUrl?: string | null
  mediaType?: "IMAGEM" | "VIDEO" | null
}

const MENU_FOOTER =
  '👉 Digite o número da opção que deseja, ou escreva a palavra (ex.: "agendar").'

const CPF_PEDIDO =
  'Envie apenas os 11 números do seu CPF.\nPara voltar ao menu, escreva "menu".'

const CPF_INCOMPLETO =
  'Este CPF está incompleto. O CPF tem 11 números — confira e envie de novo.\nPara voltar ao menu, escreva "menu".'

/** Saudações curtas avaliadas pelo motor (regex, como no bot histórico). */
const SHORT_GREETING = /^(oi|ola|hey|opa|eai|e ai)(\s|$)/

/** Normaliza o texto: minúsculas, sem acentos, espaços únicos. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function extractDigits(text: string): string {
  return text.replace(/\D/g, "")
}

function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(k))
}

/** Substitui {{clinica}} e {{link_cadastro}} nos textos do fluxo. */
function applyBotVariables(text: string, ctx: BotFlowContext): string {
  return text
    .replaceAll("{{clinica}}", ctx.clinicName)
    .replaceAll("{{link_cadastro}}", `${ctx.baseUrl}/cadastro`)
}

/** Nó RAMO (narrowing explícito do union). */
type RamoNode = Extract<FlowNode, { kind: "RAMO" }>

function asRamo(node: FlowNode): RamoNode | null {
  return node.kind === "RAMO" ? node : null
}

/** Opções numeradas dos RAMOs filhos de um nó (menu). */
function optionsOf(flow: FlowRecord, nodeId: string): RamoNode[] {
  return childrenOf(flow, nodeId)
    .map(asRamo)
    .filter((n): n is RamoNode => n !== null && typeof n.optionNumber === "number")
    .sort((a, b) => (a.optionNumber ?? 0) - (b.optionNumber ?? 0))
}

/** Monta o texto de um nó "menu": conteúdo + opções numeradas + rodapé. */
function renderMenuNode(flow: FlowRecord, nodeId: string, ctx: BotFlowContext): string {
  const node = findNode(flow, nodeId)
  if (!node || node.kind !== "MENSAGEM") return ""
  const content = applyBotVariables(node.content, ctx)
  // Sem opções próprias, usa as do hub inicial (ex.: resposta "não entendi").
  let options = optionsOf(flow, nodeId)
  if (options.length === 0) {
    const rootId = rootNodeId(flow)
    if (rootId && rootId !== nodeId) options = optionsOf(flow, rootId)
  }
  if (options.length === 0) return content
  const lines = options.map(
    (r) => `${r.optionNumber}️⃣ ${r.label}`
  )
  return [content, "", ...lines, "", MENU_FOOTER].join("\n")
}

/** Casa o RAMO do hub com o texto (opção → palavra-chave → fallback). */
function matchRamo(
  flow: FlowRecord,
  hubId: string,
  text: string
): FlowNode | null {
  const ramos = childrenOf(flow, hubId)
    .map(asRamo)
    .filter((n): n is RamoNode => n !== null)
  if (ramos.length === 0) return null

  const digits = extractDigits(text)
  if (digits.length === 1 && text === digits) {
    const byOption = ramos.find((r) => r.optionNumber === Number(digits))
    if (byOption) return byOption
  }
  const byKeyword = ramos.find(
    (r) => r.keywords.length > 0 && hasAny(text, r.keywords)
  )
  if (byKeyword) return byKeyword
  return ramos.find((r) => r.keywords.length === 0) ?? null
}

/** Executa a cadeia de resposta a partir do nó-alvo do RAMO. */
function evaluateChain(
  flow: FlowRecord,
  startId: string,
  ctx: BotFlowContext
): BotFlowResult {
  const result: BotFlowResult = {
    reply: "",
    nextState: "MENU",
    needsAttention: false,
  }
  const parts: string[] = []

  for (const node of walkChain(flow, startId)) {
    if (node.kind === "MENSAGEM") {
      const content = node.showOptions
        ? renderMenuNode(flow, node.id, ctx)
        : applyBotVariables(node.content, ctx)
      if (content) parts.push(content)
      if (node.mediaUrl) {
        result.mediaUrl = node.mediaUrl
        result.mediaType = node.mediaType ?? null
      }
      continue
    }
    if (node.kind === "ACAO") {
      switch (node.acao) {
        case "PEDIR_CPF":
          result.nextState = "AGUARDANDO_CPF"
          // Sem MENSAGEM antes: o pedido de CPF vira a resposta.
          if (parts.length === 0) {
            const intro = node.intro?.trim()
            parts.push(
              intro ? [intro, CPF_PEDIDO].join("\n") : CPF_PEDIDO
            )
          }
          break
        case "AVISAR_EQUIPE":
          result.needsAttention = true
          break
        case "HORARIO":
          parts.push(
            ctx.horarioAtendimento
              ? `Nosso horário de atendimento:\n${ctx.horarioAtendimento}`
              : 'O horário de atendimento ainda não foi cadastrado no sistema. Escreva "atendente" para falar com a nossa equipe.'
          )
          break
        case "VALORES":
          parts.push(
            [
              "Fico feliz em ajudar! 🤗",
              "Os valores variam conforme o tipo de atendimento. Para conhecer os valores e já garantir a sua consulta, faça o cadastro rapidinho:",
              `${ctx.baseUrl}/cadastro`,
              'Se preferir, escreva "atendente" para falar com a nossa equipe. 💙',
            ].join("\n")
          )
          break
        case "ENDERECO": {
          const extra = ctx.phone ? `\nTelefone: ${ctx.phone}` : ""
          parts.push(
            ctx.address
              ? `Nossa unidade fica em:\n${ctx.address}${extra}`
              : 'O endereço ainda não foi cadastrado no sistema. Escreva "atendente" para falar com a nossa equipe.'
          )
          break
        }
        case "CONTATO": {
          const linhas = ["Você pode falar com a gente por:"]
          if (ctx.phone) linhas.push(`Telefone: ${ctx.phone}`)
          if (ctx.email) linhas.push(`E-mail: ${ctx.email}`)
          if (linhas.length === 1) {
            linhas.push(
              'Os contatos ainda não foram cadastrados no sistema. Escreva "atendente" para falar com a nossa equipe.'
            )
          }
          parts.push(linhas.join("\n"))
          break
        }
        case "CONSULTAR_CONSULTAS":
          // Só é alcançado pelo estado AGUARDANDO_CPF (tratado em runBotFlow).
          break
      }
    }
  }

  result.reply = parts.join("\n")
  return result
}

/** Avalia o hub inicial (menu) com o texto recebido. */
function evaluateHub(
  flow: FlowRecord,
  text: string,
  ctx: BotFlowContext
): BotFlowResult {
  const hubId = rootNodeId(flow)
  if (!hubId) {
    return { reply: "", nextState: "MENU", needsAttention: false }
  }

  const matched = matchRamo(flow, hubId, text)
  if (!matched) {
    // Sem fallback no grafo: reapresenta o menu (comportamento seguro).
    return {
      reply: renderMenuNode(flow, hubId, ctx),
      nextState: "MENU",
      needsAttention: false,
    }
  }

  const chainStart = outgoingEdges(flow, matched.id)[0]?.target
  if (!chainStart) {
    return { reply: "", nextState: "MENU", needsAttention: false }
  }
  return evaluateChain(flow, chainStart, ctx)
}

/**
 * Decide a resposta do bot a partir do fluxo BOT salvo no banco.
 * Se o grafo não existir, o chamador deve passar o fluxo padrão
 * (flow-defaults) — o motor nunca falha por falta de fluxo.
 */
export function runBotFlow(
  state: BotState,
  rawText: string,
  ctx: BotFlowContext,
  flow: FlowRecord
): BotFlowResult {
  const text = normalizeText(rawText)
  if (!text) {
    const hubId = rootNodeId(flow)
    return {
      reply: hubId ? renderMenuNode(flow, hubId, ctx) : "",
      nextState: "MENU",
      needsAttention: false,
    }
  }

  // 1) Paciente estava no fluxo "envie seu CPF"
  if (state === "AGUARDANDO_CPF") {
    const digits = extractDigits(text)
    if (digits.length === 11) {
      return {
        reply: "", // o serviço monta a resposta com as consultas
        nextState: "MENU",
        needsAttention: false,
        cpfLookup: digits,
      }
    }
    const hubId = rootNodeId(flow)
    if (hasAny(text, ["menu", "voltar", "sair", "cancelar"])) {
      return {
        reply: hubId ? renderMenuNode(flow, hubId, ctx) : "",
        nextState: "MENU",
        needsAttention: false,
      }
    }
    if (digits.length > 0) {
      return { reply: CPF_INCOMPLETO, nextState: "AGUARDANDO_CPF", needsAttention: false }
    }
    return { reply: CPF_PEDIDO, nextState: "AGUARDANDO_CPF", needsAttention: false }
  }

  // 2) Saudações curtas (regex do bot histórico: "oi", "olá", "opa"...)
  if (SHORT_GREETING.test(text)) {
    const hubId = rootNodeId(flow)
    return {
      reply: hubId ? renderMenuNode(flow, hubId, ctx) : "",
      nextState: "MENU",
      needsAttention: false,
    }
  }

  // 3) Avaliação normal pelo grafo (opções → palavras-chave → fallback)
  return evaluateHub(flow, text, ctx)
}
