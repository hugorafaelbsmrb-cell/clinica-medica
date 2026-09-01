/**
 * Construtor do fluxo BOT padrão (grafo em memória).
 *
 * Traduz as regras históricas do bot de atendimento (menu numerado, fluxo de
 * CPF e intents por palavra-chave) para o formato de grafo do canvas. O seed
 * (scripts/migrate-flows.ts) usa este construtor com os textos atuais de
 * ClinicSettings; o motor usa com os textos padrão como fallback quando o
 * fluxo não existe no banco.
 *
 * Variáveis suportadas nos textos: {{clinica}} e {{link_cadastro}}.
 */
import type { FlowEdge, FlowNode, FlowRecord } from "./flow-types"

export const BOT_DEFAULT_TEXTS = {
  boasVindas:
    "Olá! 👋 Sou o assistente virtual da {{clinica}}. Como posso ajudar?",
  agendar: [
    "Para agendar sua consulta, é simples:",
    "1. Acesse: {{link_cadastro}}",
    "2. Informe seu CPF e siga os passos.",
    "",
    'Se precisar de ajuda, escreva "atendente".',
  ].join("\n"),
  atendente:
    "Entendi! Vou avisar a nossa equipe e alguém vai falar com você em breve.",
  saude: [
    "Não posso dar orientações de saúde por aqui — isso precisa ser avaliado por um profissional.",
    'Escreva "atendente" para falar com a nossa equipe.',
    "Em caso de urgência, procure o atendimento de saúde mais próximo.",
  ].join("\n"),
  naoEntendi: "Não entendi sua mensagem. Posso ajudar com:",
  obrigado: 'De nada! Estou aqui para ajudar. Escreva "menu" para ver as opções.',
  ok: 'Perfeito! Se precisar de mais alguma coisa, escreva "menu".',
  tchau: "Até logo! Qualquer coisa, é só chamar.",
} as const

/** Palavras-chave históricas de cada intent (ordem = prioridade). */
const KEYWORDS = {
  remarcar: ["remarcar", "desmarcar", "cancelar", "alterar", "mudar"],
  agendar: [
    "agendar",
    "marcar",
    "nova consulta",
    "horario disponivel",
    "vaga",
    "disponivel",
  ],
  verConsulta: [
    "minha consulta",
    "minhas consultas",
    "meu agendamento",
    "quando e minha",
    "ver minha",
    "ver meu",
    "minha data",
    "meu horario",
  ],
  valores: [
    "valor",
    "preco",
    "custo",
    "quanto custa",
    "quanto e",
    "quanto sai",
    "quanto fica",
  ],
  endereco: ["endereco", "onde fica", "onde e", "local", "localizacao", "chegar"],
  atendente: [
    "atendente",
    "humano",
    "pessoa",
    "falar com",
    "secretaria",
    "recepcionista",
    "enfermeir",
    "medico",
    "medica",
    "doutor",
    "doutora",
  ],
  horario: ["horario", "funciona", "funcionamento", "aberto", "abre", "fecha", "atende"],
  contato: ["telefone", "contato", "email", "e-mail", "ligar", "ligacao"],
  saude: [
    "dor",
    "sintoma",
    "sintomas",
    "doenca",
    "doente",
    "remedio",
    "medicamento",
    "receita",
    "pressao",
    "febre",
    "exame",
    "resultado",
    "diarreia",
    "vomito",
    "falta de ar",
    "mal estar",
    "passando mal",
    "urgencia",
    "emergencia",
    "crise",
  ],
  saudacao: ["bom dia", "boa tarde", "boa noite", "tudo bem", "tudo bom"],
  obrigado: ["obrigado", "obrigada", "valeu", "agradecido", "grato"],
  ok: ["ok", "certo", "beleza", "blz", "ta bom", "tudo certo"],
  tchau: ["tchau", "ate mais", "ate logo", "adeus"],
  menu: ["menu", "opcoes", "inicio"],
} as const

// Espalha para string[] mutável (o tipo FlowNode espera string[]).
const KW = {
  remarcar: [...KEYWORDS.remarcar],
  agendar: [...KEYWORDS.agendar],
  verConsulta: [...KEYWORDS.verConsulta],
  valores: [...KEYWORDS.valores],
  endereco: [...KEYWORDS.endereco],
  atendente: [...KEYWORDS.atendente],
  horario: [...KEYWORDS.horario],
  contato: [...KEYWORDS.contato],
  saude: [...KEYWORDS.saude],
  saudacao: [...KEYWORDS.saudacao],
  obrigado: [...KEYWORDS.obrigado],
  ok: [...KEYWORDS.ok],
  tchau: [...KEYWORDS.tchau],
  menu: [...KEYWORDS.menu],
}

export type BotFlowOptions = {
  boasVindas?: string | null
  agendar?: string | null
  atendente?: string | null
  saude?: string | null
  phone?: string | null
}

function m(
  id: string,
  x: number,
  y: number,
  content: string,
  extra?: { showOptions?: boolean; mediaUrl?: string | null; mediaType?: "IMAGEM" | "VIDEO" | null }
): FlowNode {
  return {
    id,
    kind: "MENSAGEM",
    content,
    showOptions: extra?.showOptions,
    mediaUrl: extra?.mediaUrl ?? null,
    mediaType: extra?.mediaType ?? null,
    position: { x, y },
  }
}

function ramo(
  id: string,
  label: string,
  keywords: string[],
  optionNumber: number | null,
  y: number
): FlowNode {
  return {
    id,
    kind: "RAMO",
    label,
    keywords,
    optionNumber,
    position: { x: 760, y },
  }
}

function acao(
  id: string,
  acaoType: Extract<FlowNode, { kind: "ACAO" }>["acao"],
  x: number,
  y: number,
  intro?: string
): FlowNode {
  return { id, kind: "ACAO", acao: acaoType, intro, position: { x, y } }
}

function edge(id: string, source: string, target: string): FlowEdge {
  return { id, source, target }
}

/** Monta o fluxo BOT padrão com os textos informados (vazio = padrão). */
export function buildBotFlow(opts: BotFlowOptions): FlowRecord {
  const boasVindas = opts.boasVindas?.trim() || BOT_DEFAULT_TEXTS.boasVindas
  const agendar = opts.agendar?.trim() || BOT_DEFAULT_TEXTS.agendar
  const atendente = opts.atendente?.trim() || BOT_DEFAULT_TEXTS.atendente
  const saude = opts.saude?.trim() || BOT_DEFAULT_TEXTS.saude
  const phone = opts.phone?.trim() || null

  const nodes: FlowNode[] = [
    { id: "gatilho", kind: "GATILHO", gatilho: "mensagem_recebida", position: { x: 0, y: 300 } },
    m("menu", 360, 300, boasVindas, { showOptions: true }),
    m("resp_agendar", 1120, 60, agendar),
    m("resp_atendente", 1120, 540, atendente),
    m("resp_saude", 1120, 1560, saude),
    m("resp_nao_entendi", 1120, 2400, BOT_DEFAULT_TEXTS.naoEntendi, { showOptions: true }),
    m("resp_obrigado", 1120, 1800, BOT_DEFAULT_TEXTS.obrigado),
    m("resp_ok", 1120, 1920, BOT_DEFAULT_TEXTS.ok),
    m("resp_tchau", 1120, 2040, BOT_DEFAULT_TEXTS.tchau),
    acao("acao_pedir_cpf_ver", "PEDIR_CPF", 1120, 240, "Para consultar seus agendamentos, me envie o seu CPF."),
    acao("acao_pedir_cpf_remarcar", "PEDIR_CPF", 1120, 360, "Para remarcar uma consulta, me envie o seu CPF."),
    acao("acao_horario", "HORARIO", 1120, 480),
    acao("acao_avisar", "AVISAR_EQUIPE", 1480, 540),
    acao("acao_valores", "VALORES", 1120, 1200),
    acao("acao_endereco", "ENDERECO", 1120, 1320),
    acao("acao_contato", "CONTATO", 1120, 1440),
  ]

  // Aviso de urgência com telefone: só quando a clínica tem telefone e a
  // mensagem de atendente é a padrão (a customizada não ganha a linha).
  if (phone && !opts.atendente?.trim()) {
    nodes.push(
      m("resp_atendente_fone", 1480, 420, `Se for urgente, ligue para ${phone}.`)
    )
  }

  const ramos: FlowNode[] = [
    ramo("ramo_op1", "Agendar uma consulta 📅", [], 1, 60),
    ramo("ramo_op2", "Ver minha consulta 🔎", [], 2, 180),
    ramo("ramo_op3", "Remarcar consulta 🔁", [], 3, 300),
    ramo("ramo_op4", "Horário de atendimento 🕒", [], 4, 420),
    ramo("ramo_op5", "Falar com um atendente 👩‍⚕️", [], 5, 540),
    ramo("ramo_remarcar", "Remarcar/cancelar", KW.remarcar, null, 660),
    ramo("ramo_agendar", "Agendar consulta", KW.agendar, null, 780),
    ramo("ramo_ver", "Ver minha consulta", KW.verConsulta, null, 900),
    ramo("ramo_valores", "Valores e preços", KW.valores, null, 1020),
    ramo("ramo_endereco", "Endereço", KW.endereco, null, 1140),
    ramo("ramo_atendente", "Falar com atendente", KW.atendente, null, 1260),
    ramo("ramo_horario", "Horário de atendimento", KW.horario, null, 1380),
    ramo("ramo_contato", "Telefone/contato", KW.contato, null, 1500),
    ramo("ramo_saude", "Saúde (segurança)", KW.saude, null, 1620),
    ramo("ramo_saudacao", "Saudação", KW.saudacao, null, 1740),
    ramo("ramo_obrigado", "Agradecimento", KW.obrigado, null, 1860),
    ramo("ramo_ok", "Confirmação (ok)", KW.ok, null, 1980),
    ramo("ramo_tchau", "Despedida", KW.tchau, null, 2100),
    ramo("ramo_menu", "Voltar ao menu", KW.menu, null, 2220),
    ramo("ramo_fallback", "Qualquer outra mensagem", [], null, 2400),
  ]
  nodes.push(...ramos)

  const edges: FlowEdge[] = [
    edge("e_gatilho", "gatilho", "menu"),
    ...ramos.map((r, i) => edge(`e_menu_${i}`, "menu", r.id)),
    edge("e_op1", "ramo_op1", "resp_agendar"),
    edge("e_op2", "ramo_op2", "acao_pedir_cpf_ver"),
    edge("e_op3", "ramo_op3", "acao_pedir_cpf_remarcar"),
    edge("e_op4", "ramo_op4", "acao_horario"),
    edge("e_op5", "ramo_op5", "resp_atendente"),
    edge("e_atendente_avisar", "resp_atendente", "acao_avisar"),
    ...(phone && !opts.atendente?.trim()
      ? [edge("e_atendente_fone", "acao_avisar", "resp_atendente_fone")]
      : []),
    edge("e_remarcar", "ramo_remarcar", "acao_pedir_cpf_remarcar"),
    edge("e_agendar", "ramo_agendar", "resp_agendar"),
    edge("e_ver", "ramo_ver", "acao_pedir_cpf_ver"),
    edge("e_valores", "ramo_valores", "acao_valores"),
    edge("e_endereco", "ramo_endereco", "acao_endereco"),
    edge("e_atendente_kw", "ramo_atendente", "resp_atendente"),
    edge("e_horario", "ramo_horario", "acao_horario"),
    edge("e_contato", "ramo_contato", "acao_contato"),
    edge("e_saude", "ramo_saude", "resp_saude"),
    edge("e_saudacao", "ramo_saudacao", "menu"),
    edge("e_obrigado", "ramo_obrigado", "resp_obrigado"),
    edge("e_ok", "ramo_ok", "resp_ok"),
    edge("e_tchau", "ramo_tchau", "resp_tchau"),
    edge("e_menu", "ramo_menu", "menu"),
    edge("e_fallback", "ramo_fallback", "resp_nao_entendi"),
  ]

  return {
    id: "bot-padrao",
    kind: "BOT",
    name: "Bot de atendimento",
    description: null,
    enabled: true,
    nodes,
    edges,
  }
}
