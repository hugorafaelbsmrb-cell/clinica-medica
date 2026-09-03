/**
 * Tipos e utilitários dos fluxos de mensagens (grafo estilo n8n).
 *
 * Um fluxo é um grafo salvo em JSON na tabela MessageFlow:
 *  - BOT: nó GATILHO "mensagem_recebida" → MENSAGEM (menu) com RAMOs filhos
 *    (condições por opção numerada / palavra-chave / fallback) levando às
 *    cadeias de resposta (MENSAGEM + ACAO).
 *  - AUTOMACAO: GATILHO com o evento disparador → cadeia de MENSAGEMs
 *    encadeadas por arestas com delayMinutes.
 *  - JORNADA: GATILHO "inicio_manual" → cadeia de MENSAGEMs com delays.
 */

export type GatilhoTipo =
  | "mensagem_recebida" // BOT: qualquer mensagem recebida
  | "inicio_manual" // JORNADA: disparo manual por paciente no painel
  | "cadastro_incompleto" // AUTOMACAO: lembretes de pré-cadastro não finalizado
  | "whatsapp_contato" // AUTOMACAO: lembretes de quem só mandou mensagem
  | "tratamento_periodico" // AUTOMACAO: config.intervalDays
  | "aniversario" // AUTOMACAO: no dia do aniversário (1x por ano)
  | "reativacao" // AUTOMACAO: config.days sem consulta
  | "agradecimento" // AUTOMACAO: consulta marcada como REALIZADO
  | "acaminho" // AUTOMACAO: atendimento presencial/domiciliar iniciado
  | "link_pagamento" // AUTOMACAO: horário reservado (link de pagamento)
  | "lembrete_pagamento" // AUTOMACAO: config.delayMinutes, cobrança avulsa pendente
  | "pagamento_confirmado" // AUTOMACAO: pagamento recebido
  | "agendamento_followup" // AUTOMACAO: lembretes de reserva online não paga
  | "agendamento_cancelado" // AUTOMACAO: reserva liberada por falta de pagamento

export type FlowNode =
  | {
      id: string
      position: { x: number; y: number }
      kind: "GATILHO"
      gatilho: GatilhoTipo
      /** Parâmetros do gatilho (ex.: intervalDays, days, delayMinutes). */
      config?: Record<string, unknown>
    }
  | {
      id: string
      position: { x: number; y: number }
      kind: "MENSAGEM"
      /** Texto da mensagem (ou legenda, quando há mídia). */
      content: string
      mediaUrl?: string | null
      mediaType?: "IMAGEM" | "VIDEO" | null
      /** BOT: anexa as opções numeradas dos RAMOs filhos ao texto. */
      showOptions?: boolean
    }
  | {
      id: string
      position: { x: number; y: number }
      kind: "PEDIR_NOME"
      /**
       * BOT: boas-vindas que pede o nome de quem ainda não é paciente.
       * Variáveis: {{clinica}}.
       */
      content: string
    }
  | {
      id: string
      position: { x: number; y: number }
      kind: "PORTAO"
      /**
       * BOT: pergunta "já é paciente ou primeira consulta?". Os RAMOs
       * filhos (com opção numerada) viram botões de resposta rápida.
       * Variáveis: {{nome}}.
       */
      content: string
    }
  | {
      id: string
      position: { x: number; y: number }
      kind: "RAMO"
      label: string
      /** Palavras que ativam o ramo ("contém"). Vazio = fallback. */
      keywords: string[]
      /** BOT: opção numerada do menu (1–9). */
      optionNumber?: number | null
    }
  | {
      id: string
      position: { x: number; y: number }
      kind: "ACAO"
      acao:
        | "PEDIR_CPF"
        | "CONSULTAR_CONSULTAS"
        | "AVISAR_EQUIPE"
        | "HORARIO"
        | "VALORES"
        | "ENDERECO"
        | "CONTATO"
      /** PEDIR_CPF: frase de entrada (ex.: "Para remarcar uma consulta..."). */
      intro?: string
    }

export type FlowEdge = {
  id: string
  source: string
  target: string
  /** AUTOMACAO/JORNADA: tempo até o próximo nó (minutos). */
  delayMinutes?: number
}

export type FlowKind = "BOT" | "AUTOMACAO" | "JORNADA"

/** Linha da tabela MessageFlow com os JSONs convertidos. */
export type FlowRecord = {
  id: string
  kind: FlowKind
  name: string
  description: string | null
  enabled: boolean
  nodes: FlowNode[]
  edges: FlowEdge[]
}

/** Converte o JSON bruto do banco em nós tipados (tolerante a lixo). */
export function parseFlowNodes(raw: unknown): FlowNode[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (n): n is FlowNode =>
      !!n &&
      typeof n === "object" &&
      typeof (n as { id?: unknown }).id === "string" &&
      typeof (n as { kind?: unknown }).kind === "string"
  )
}

export function parseFlowEdges(raw: unknown): FlowEdge[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (e): e is FlowEdge =>
      !!e &&
      typeof e === "object" &&
      typeof (e as { id?: unknown }).id === "string" &&
      typeof (e as { source?: unknown }).source === "string" &&
      typeof (e as { target?: unknown }).target === "string"
  )
}

export function findNode(flow: FlowRecord, nodeId: string): FlowNode | null {
  return flow.nodes.find((n) => n.id === nodeId) ?? null
}

/** Arestas que saem de um nó (na ordem em que foram salvas). */
export function outgoingEdges(flow: FlowRecord, nodeId: string): FlowEdge[] {
  return flow.edges.filter((e) => e.source === nodeId)
}

/** Nós-alvo das arestas que saem do nó (na ordem das arestas). */
export function childrenOf(flow: FlowRecord, nodeId: string): FlowNode[] {
  const ids = outgoingEdges(flow, nodeId).map((e) => e.target)
  return ids
    .map((id) => findNode(flow, id))
    .filter((n): n is FlowNode => n !== null)
}

/** Primeiro nó do fluxo (o GATILHO). */
export function triggerNode(flow: FlowRecord): FlowNode | null {
  return flow.nodes.find((n) => n.kind === "GATILHO") ?? null
}

/** Nó-alvo imediato do GATILHO (início da avaliação). */
export function rootNodeId(flow: FlowRecord): string | null {
  const trigger = triggerNode(flow)
  if (!trigger) return null
  return outgoingEdges(flow, trigger.id)[0]?.target ?? null
}

/** Primeiro nó do fluxo com o kind informado (portão de identificação). */
export function nodeOfKind<K extends "PEDIR_NOME" | "PORTAO">(
  flow: FlowRecord,
  kind: K
): Extract<FlowNode, { kind: K }> | null {
  const node = flow.nodes.find((n) => n.kind === kind)
  return node ? (node as Extract<FlowNode, { kind: K }>) : null
}

/**
 * Hub do menu do bot: o nó "menu" por convenção; em fluxos com portão,
 * o alvo do RAMO fallback do portão; senão, o primeiro nó do gatilho.
 */
export function menuNodeId(flow: FlowRecord): string | null {
  const named = findNode(flow, "menu")
  if (named && named.kind === "MENSAGEM") return "menu"
  const portao = nodeOfKind(flow, "PORTAO")
  if (portao) {
    const fallback = childrenOf(flow, portao.id).find(
      (n) => n.kind === "RAMO" && n.keywords.length === 0 && n.optionNumber == null
    )
    const target = fallback ? outgoingEdges(flow, fallback.id)[0]?.target : null
    if (target) return target
  }
  return rootNodeId(flow)
}

/**
 * Cadeia linear a partir de um nó: percorre enquanto houver exatamente uma
 * aresta de saída que não leve a um RAMO (RAMOs são filhos de "hub" e só são
 * avaliados quando o motor parte do hub). Retorna os nós na ordem.
 */
export function walkChain(flow: FlowRecord, startId: string): FlowNode[] {
  const result: FlowNode[] = []
  const visited = new Set<string>()
  let currentId: string | null = startId
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const node = findNode(flow, currentId)
    if (!node || node.kind === "RAMO") break
    result.push(node)
    const nextIds: string[] = outgoingEdges(flow, currentId)
      .map((e) => e.target)
      .filter((id) => findNode(flow, id)?.kind !== "RAMO")
    currentId = nextIds.length === 1 ? nextIds[0] : null
  }
  return result
}

/** Mensagens da cadeia do fluxo com o atraso acumulado de cada uma. */
export function flowMessageChain(flow: FlowRecord): Array<{
  node: Extract<FlowNode, { kind: "MENSAGEM" }>
  dueMinutes: number
}> {
  const rootId = rootNodeId(flow)
  if (!rootId) return []
  const messages: Array<{
    node: Extract<FlowNode, { kind: "MENSAGEM" }>
    dueMinutes: number
  }> = []
  let cumulative = 0
  let currentId: string | null = rootId
  const visited = new Set<string>()
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const node = findNode(flow, currentId)
    if (!node) break
    if (node.kind === "MENSAGEM") {
      messages.push({ node, dueMinutes: cumulative })
    }
    if (node.kind === "RAMO") break
    const edge: FlowEdge | undefined = outgoingEdges(flow, currentId)[0]
    if (!edge) break
    cumulative += edge.delayMinutes ?? 0
    currentId = edge.target
  }
  return messages
}

/** Quantidade de mensagens do fluxo (usada no select de jornadas). */
export function countMessageNodes(flow: FlowRecord): number {
  return flow.nodes.filter((n) => n.kind === "MENSAGEM").length
}

export const GATILHO_LABELS: Record<GatilhoTipo, string> = {
  mensagem_recebida: "Mensagem recebida",
  inicio_manual: "Início manual (painel)",
  cadastro_incompleto: "Cadastro incompleto",
  whatsapp_contato: "Contato pelo WhatsApp",
  tratamento_periodico: "Tratamento periódico",
  aniversario: "Aniversário",
  reativacao: "Reativação",
  agradecimento: "Pós-consulta (agradecimento)",
  acaminho: "Médico a caminho",
  link_pagamento: "Link de pagamento",
  lembrete_pagamento: "Lembrete de pagamento",
  pagamento_confirmado: "Pagamento confirmado",
  agendamento_followup: "Reserva online não paga",
  agendamento_cancelado: "Reserva liberada",
}
