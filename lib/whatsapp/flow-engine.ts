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
import type { WhatsAppButton } from "./provider"
import {
  childrenOf,
  findNode,
  menuNodeId,
  nodeOfKind,
  outgoingEdges,
  rootNodeId,
  walkChain,
} from "./flow-types"

export type BotState =
  | "MENU"
  | "AGUARDANDO_CPF"
  | "AGUARDANDO_NOME"
  | "AGUARDANDO_TIPO"

/** Modalidade de consulta escolhida pelo cliente no bot. */
export type BotModalityId = "PRESENCIAL" | "DOMICILIAR" | "TELECONSULTA"

/** Modalidade habilitada com preço — alimenta {{precos}} e os botões. */
export type BotModality = {
  id: BotModalityId
  label: string
  price: number
}

export type BotFlowContext = {
  clinicName: string
  address?: string | null
  phone?: string | null
  email?: string | null
  horarioAtendimento?: string | null
  baseUrl: string
  /** Primeiro nome do contato (substitui {{nome}} no portão). */
  firstName?: string | null
  /** Link de cadastro personalizado do lead (substitui {{link_lead}}). */
  leadLink?: string | null
  /**
   * Modalidades habilitadas da clínica com os preços — viram o texto de
   * {{precos}} e os botões de escolha do portão e da ação VALORES.
   */
  modalities?: BotModality[]
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
  /** Botões de resposta rápida do PORTAO (o serviço envia junto com o texto). */
  buttons?: WhatsAppButton[]
  /** Nome capturado pelo PEDIR_NOME: o serviço grava no contato. */
  capturedName?: string | null
  /** Modalidade escolhida no portão — o serviço monta o link com &tipo=. */
  chosenModality?: BotModalityId
}

const MENU_FOOTER =
  '👉 Digite o número da opção que deseja, ou escreva a palavra (ex.: "agendar").'

const CPF_PEDIDO =
  'Envie apenas os 11 números do seu CPF.\nPara voltar ao menu, escreva "menu".'

const CPF_INCOMPLETO =
  'Este CPF está incompleto. O CPF tem 11 números — confira e envie de novo.\nPara voltar ao menu, escreva "menu".'

const NOME_INVALIDO =
  "Desculpa, não entendi. Me diz seu nome completo, por favor."

/** Palavras que escapam do pedido de nome direto para o motor. */
const ATENDENTE_KEYWORDS = ["atendente", "humano", "secretaria", "recepcionista"]

/** Saudações curtas avaliadas pelo motor (regex, como no bot histórico). */
const SHORT_GREETING = /^(oi|ola|hey|opa|eai|e ai)(\s|$)/

/** Palavras do próprio bot que nunca são nome de pessoa. */
const NON_NAME_WORDS = new Set([
  "menu",
  "opcoes",
  "inicio",
  "atendente",
  "humano",
  "oi",
  "ola",
  "hey",
  "opa",
  "bom dia",
  "boa tarde",
  "boa noite",
  "tudo bem",
  "tudo bom",
  "tchau",
  "obrigado",
  "obrigada",
  "valeu",
  "ok",
  "certo",
  "cancelar",
  "sair",
  "voltar",
])

/** Extrai um nome plausível da mensagem (null = pedir de novo). */
export function parseNameFromMessage(content: string): string | null {
  const trimmed = content.trim().replace(/\s+/g, " ")
  if (trimmed.length < 2 || trimmed.length > 60) return null
  if (/^\d+$/.test(trimmed)) return null
  if (trimmed.replace(/\D/g, "").length >= 6) return null // telefone/CPF
  if (NON_NAME_WORDS.has(normalizeText(trimmed))) return null
  return trimmed
}

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

/** Emoji de cada modalidade na lista de preços do bot. */
const MODALITY_EMOJI: Record<BotModalityId, string> = {
  DOMICILIAR: "🏠",
  TELECONSULTA: "💻",
  PRESENCIAL: "🏥",
}

/** Lista de preços formatada em pt-BR (vira o texto de {{precos}}). */
function formatPricesText(ctx: BotFlowContext): string {
  const modalities = ctx.modalities ?? []
  return modalities
    .map(
      (m) =>
        `${MODALITY_EMOJI[m.id]} ${m.label}: ${m.price.toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        })}`
    )
    .join("\n")
}

/** Botões de escolha de modalidade (um por modalidade habilitada). */
function choiceButtons(ctx: BotFlowContext): WhatsAppButton[] {
  return (ctx.modalities ?? []).map((m) => ({
    type: "REPLY",
    label: m.label,
  }))
}

/** Substitui as variáveis {{clinica}}, {{link_cadastro}}, {{link_lead}}, {{nome}} e {{precos}}. */
function applyBotVariables(text: string, ctx: BotFlowContext): string {
  return text
    .replaceAll("{{clinica}}", ctx.clinicName)
    .replaceAll("{{link_cadastro}}", `${ctx.baseUrl}/cadastro`)
    .replaceAll("{{link_lead}}", ctx.leadLink ?? `${ctx.baseUrl}/cadastro`)
    .replaceAll("{{nome}}", ctx.firstName ?? "")
    .replaceAll("{{precos}}", formatPricesText(ctx))
}

/** Nó RAMO (narrowing explícito do union). */
type RamoNode = Extract<FlowNode, { kind: "RAMO" }>

function asRamo(node: FlowNode): RamoNode | null {
  return node.kind === "RAMO" ? node : null
}

/** Modalidade do ramo do portão, inferida pelas palavras-chave. */
function modalityOfRamo(ramo: RamoNode): BotModalityId | undefined {
  const kw = ramo.keywords.join(" ")
  if (/domiciliar|casa|visita/.test(kw)) return "DOMICILIAR"
  if (/teleconsulta|\btele\b|video|online|remoto|virtual/.test(kw)) {
    return "TELECONSULTA"
  }
  if (/presencial/.test(kw)) return "PRESENCIAL"
  return undefined
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
  // Sem opções próprias, usa as do hub do menu (ex.: resposta "não entendi").
  let options = optionsOf(flow, nodeId)
  if (options.length === 0) {
    const menuId = menuNodeId(flow)
    if (menuId && menuId !== nodeId) options = optionsOf(flow, menuId)
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
): RamoNode | null {
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

/** Botões de resposta rápida do PORTAO (um por RAMO filho numerado). */
function gatewayButtons(flow: FlowRecord, portaoId: string): WhatsAppButton[] {
  return optionsOf(flow, portaoId).map((r) => ({
    type: "REPLY",
    label: r.label,
  }))
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
    if (node.kind === "PEDIR_NOME") {
      result.nextState = "AGUARDANDO_NOME"
      const content = applyBotVariables(node.content, ctx)
      if (content) parts.push(content)
      // O nome chega na próxima mensagem: para a cadeia aqui.
      break
    }
    if (node.kind === "PORTAO") {
      result.nextState = "AGUARDANDO_TIPO"
      const content = applyBotVariables(node.content, ctx)
      if (content) parts.push(content)
      // Botões derivados das modalidades habilitadas (preços da clínica);
      // sem modalidades no contexto, cai nos RAMOs numerados do portão.
      const modalities = ctx.modalities ?? []
      result.buttons =
        modalities.length > 0 ? choiceButtons(ctx) : gatewayButtons(flow, node.id)
      if (result.buttons.length === 0) {
        // Sem opção de escolha (clínica sem modalidade habilitada):
        // reapresenta o menu em vez de travar o contato no portão.
        const menuId = menuNodeId(flow)
        const menuContent = menuId ? renderMenuNode(flow, menuId, ctx) : ""
        if (menuContent) parts.push(menuContent)
        result.nextState = "MENU"
        result.buttons = []
      }
      // Os botões do portão aguardam a escolha: para a cadeia aqui.
      break
    }
    if (node.kind === "ACAO") {
      // VALORES com preços vira escolha por botões: a cadeia para aqui e
      // o motor passa a aguardar a modalidade (estado AGUARDANDO_TIPO).
      let stopChain = false
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
        case "VALORES": {
          const prices = formatPricesText(ctx)
          if (prices) {
            parts.push(
              [
                "Nossos valores:",
                "",
                prices,
                "",
                "Escolha uma das opções abaixo:",
              ].join("\n")
            )
            result.buttons = choiceButtons(ctx)
            result.nextState = "AGUARDANDO_TIPO"
            stopChain = true
          } else {
            // Sem preços cadastrados: mantém o convite ao cadastro.
            parts.push(
              [
                "Fico feliz em ajudar! 🤗",
                "Os valores variam conforme o tipo de atendimento. Para conhecer os valores e já garantir a sua consulta, faça o cadastro rapidinho:",
                `${ctx.baseUrl}/cadastro`,
                'Se preferir, escreva "atendente" para falar com a nossa equipe. 💙',
              ].join("\n")
            )
          }
          break
        }
        case "ENDERECO": {
          // Atendimento 100% domiciliar: não há unidade física para visitar.
          parts.push(
            `A ${ctx.clinicName} atende exclusivamente em domicílio! 💙 Nossa equipe médica vai até você — em casa, no trabalho, onde você estiver. Quer agendar sua consulta? Escreva "agendar" ou "atendente" para falar com a gente.`
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
      if (stopChain) break
    }
  }

  result.reply = parts.join("\n")
  return result
}

/** Avalia um hub do grafo (menu ou nó inicial) com o texto recebido. */
function evaluateHub(
  flow: FlowRecord,
  hubId: string,
  text: string,
  ctx: BotFlowContext
): BotFlowResult {
  const hubNode = findNode(flow, hubId)
  if (!hubNode) {
    return { reply: "", nextState: "MENU", needsAttention: false }
  }
  // Portão/pedido de nome não são hubs de menu: a cadeia decide o estado.
  if (hubNode.kind === "PEDIR_NOME" || hubNode.kind === "PORTAO") {
    return evaluateChain(flow, hubId, ctx)
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
 *
 * `startNodeId` substitui o hub de partida (rootNodeId): pacientes e
 * contatos com nome começam direto no menu; quem ainda não é paciente e
 * não tem nome começa no PEDIR_NOME do portão.
 */
export function runBotFlow(
  state: BotState,
  rawText: string,
  ctx: BotFlowContext,
  flow: FlowRecord,
  startNodeId?: string | null
): BotFlowResult {
  const text = normalizeText(rawText)
  const menuId = menuNodeId(flow)
  const hubId = startNodeId ?? rootNodeId(flow)
  if (!text) {
    return {
      reply: menuId ? renderMenuNode(flow, menuId, ctx) : "",
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
    if (hasAny(text, ["menu", "voltar", "sair", "cancelar"])) {
      return {
        reply: menuId ? renderMenuNode(flow, menuId, ctx) : "",
        nextState: "MENU",
        needsAttention: false,
      }
    }
    if (digits.length > 0) {
      return { reply: CPF_INCOMPLETO, nextState: "AGUARDANDO_CPF", needsAttention: false }
    }
    return { reply: CPF_PEDIDO, nextState: "AGUARDANDO_CPF", needsAttention: false }
  }

  // 2) Portão: contato no passo "me diz seu nome"
  if (state === "AGUARDANDO_NOME") {
    const pedirNome = nodeOfKind(flow, "PEDIR_NOME")
    if (pedirNome) {
      const name = parseNameFromMessage(rawText)
      if (name) {
        // Nome válido: segue a cadeia (o nó seguinte é o PORTAO).
        const next = outgoingEdges(flow, pedirNome.id)[0]?.target
        const named = {
          ...ctx,
          firstName: name.split(" ")[0],
        }
        return {
          ...(next ? evaluateChain(flow, next, named) : { reply: "", nextState: "MENU" as BotState, needsAttention: false }),
          capturedName: name,
        }
      }
      if (hasAny(text, ATENDENTE_KEYWORDS)) {
        // Pediu atendente sem informar nome: o motor assume (ramo atendente).
        return menuId
          ? evaluateHub(flow, menuId, text, ctx)
          : { reply: "", nextState: "MENU", needsAttention: false }
      }
      return { reply: NOME_INVALIDO, nextState: "AGUARDANDO_NOME", needsAttention: false }
    }
    // Fluxo sem portão: cai no motor normalmente.
    return hubId
      ? evaluateHub(flow, hubId, text, ctx)
      : { reply: "", nextState: "MENU", needsAttention: false }
  }

  // 3) Portão: contato no passo de escolha da modalidade (botões de preço)
  if (state === "AGUARDANDO_TIPO") {
    const portao = nodeOfKind(flow, "PORTAO")
    if (portao) {
      const matched = matchRamo(flow, portao.id, text)
      if (matched) {
        let chainStart = outgoingEdges(flow, matched.id)[0]?.target
        if (chainStart) {
          const startNode = findNode(flow, chainStart)
          // Quem já tem nome não passa de novo pelo PEDIR_NOME: a cadeia
          // pula direto para o nó seguinte (a mensagem com o link da agenda).
          if (startNode?.kind === "PEDIR_NOME" && ctx.firstName) {
            chainStart =
              outgoingEdges(flow, startNode.id)[0]?.target ?? undefined
          }
          if (chainStart) {
            const result = evaluateChain(flow, chainStart, ctx)
            result.chosenModality = modalityOfRamo(matched)
            return result
          }
        }
      }
      // Qualquer outra resposta cai no motor (menu, atendente...).
      return menuId
        ? evaluateHub(flow, menuId, text, ctx)
        : { reply: "", nextState: "MENU", needsAttention: false }
    }
    return hubId
      ? evaluateHub(flow, hubId, text, ctx)
      : { reply: "", nextState: "MENU", needsAttention: false }
  }

  // 4) Saudações curtas (regex do bot histórico: "oi", "olá", "opa"...)
  if (SHORT_GREETING.test(text)) {
    // Desconhecido sem nome ainda não passou pelo portão: a saudação
    // também dispara o pedido de nome (como no fluxo antigo).
    if (hubId) {
      const startNode = findNode(flow, hubId)
      if (startNode && (startNode.kind === "PEDIR_NOME" || startNode.kind === "PORTAO")) {
        return evaluateHub(flow, hubId, text, ctx)
      }
    }
    return {
      reply: menuId ? renderMenuNode(flow, menuId, ctx) : "",
      nextState: "MENU",
      needsAttention: false,
    }
  }

  // 5) Avaliação normal pelo grafo (opções → palavras-chave → fallback)
  return hubId
    ? evaluateHub(flow, hubId, text, ctx)
    : { reply: "", nextState: "MENU", needsAttention: false }
}
