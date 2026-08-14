/**
 * Motor do bot de atendimento no WhatsApp (regras fixas, sem IA).
 *
 * Função pura e testável: recebe o estado da sessão + a mensagem normalizada
 * + o contexto da clínica e devolve a resposta, o próximo estado e as ações
 * necessárias (ex.: buscar consultas pelo CPF, avisar a equipe).
 *
 * O serviço (bot-service.ts) é quem consulta o banco e envia a resposta.
 */

export type BotState = "MENU" | "AGUARDANDO_CPF"

export type BotContext = {
  clinicName: string
  address?: string | null
  phone?: string | null
  email?: string | null
  horarioAtendimento?: string | null
  baseUrl: string
  /** Mensagens personalizadas pela clínica (vazio = usa o padrão). */
  msgAtendente?: string | null
  msgSaude?: string | null
  msgBoasVindas?: string | null
  msgAgendar?: string | null
}

export type BotResult = {
  reply: string
  nextState: BotState
  needsAttention: boolean
  /** CPF extraído da mensagem: o serviço busca as consultas e monta a resposta. */
  cpfLookup?: string
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

function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(k))
}

function extractDigits(text: string): string {
  return text.replace(/\D/g, "")
}

const OPCOES_MENU = [
  "1 - Agendar uma consulta",
  "2 - Ver minha consulta",
  "3 - Remarcar consulta",
  "4 - Endereço",
  "5 - Horário de atendimento",
  "6 - Telefone e contato",
  "7 - Falar com um atendente",
]

function menuReply(ctx: BotContext): string {
  const boasVindas = ctx.msgBoasVindas?.trim()
  const saudacao = boasVindas
    ? boasVindas
    : `Olá! Sou o assistente virtual da ${ctx.clinicName}. Como posso ajudar?`
  return [
    saudacao,
    "",
    ...OPCOES_MENU,
    "",
    'Responda com o número ou escreva a palavra (ex.: "agendar").',
  ].join("\n")
}

function pedirCpf(ctx: BotContext, intro: string): BotResult {
  return {
    reply: [
      intro,
      "Envie apenas os 11 números do seu CPF.",
      'Para voltar ao menu, escreva "menu".',
    ].join("\n"),
    nextState: "AGUARDANDO_CPF",
    needsAttention: false,
  }
}

function respostaAgendar(ctx: BotContext): BotResult {
  if (ctx.msgAgendar?.trim()) {
    return {
      reply: ctx.msgAgendar.trim(),
      nextState: "MENU",
      needsAttention: false,
    }
  }
  return {
    reply: [
      "Para agendar sua consulta, é simples:",
      `1. Acesse: ${ctx.baseUrl}/cadastro`,
      "2. Informe seu CPF e siga os passos.",
      "",
      'Se precisar de ajuda, escreva "atendente".',
    ].join("\n"),
    nextState: "MENU",
    needsAttention: false,
  }
}

function respostaEndereco(ctx: BotContext): BotResult {
  const extra = ctx.phone ? `\nTelefone: ${ctx.phone}` : ""
  return {
    reply: ctx.address
      ? `Nossa unidade fica em:\n${ctx.address}${extra}`
      : `O endereço ainda não foi cadastrado no sistema. Escreva "atendente" para falar com a nossa equipe.`,
    nextState: "MENU",
    needsAttention: false,
  }
}

function respostaHorario(ctx: BotContext): BotResult {
  return {
    reply: ctx.horarioAtendimento
      ? `Nosso horário de atendimento:\n${ctx.horarioAtendimento}`
      : `O horário de atendimento ainda não foi cadastrado no sistema. Escreva "atendente" para falar com a nossa equipe.`,
    nextState: "MENU",
    needsAttention: false,
  }
}

function respostaContato(ctx: BotContext): BotResult {
  const linhas = ["Você pode falar com a gente por:"]
  if (ctx.phone) linhas.push(`Telefone: ${ctx.phone}`)
  if (ctx.email) linhas.push(`E-mail: ${ctx.email}`)
  if (linhas.length === 1) {
    linhas.push(
      "Os contatos ainda não foram cadastrados no sistema. Escreva \"atendente\" para falar com a nossa equipe."
    )
  }
  return { reply: linhas.join("\n"), nextState: "MENU", needsAttention: false }
}

function respostaAtendente(ctx: BotContext): BotResult {
  if (ctx.msgAtendente?.trim()) {
    return {
      reply: ctx.msgAtendente.trim(),
      nextState: "MENU",
      needsAttention: true,
    }
  }
  const urgente = ctx.phone
    ? `\nSe for urgente, ligue para ${ctx.phone}.`
    : ""
  return {
    reply: `Entendi! Vou avisar a nossa equipe e alguém vai falar com você em breve.${urgente}`,
    nextState: "MENU",
    needsAttention: true,
  }
}

function respostaSaude(ctx: BotContext): BotResult {
  if (ctx.msgSaude?.trim()) {
    return { reply: ctx.msgSaude.trim(), nextState: "MENU", needsAttention: false }
  }
  const contato = ctx.phone
    ? `Fale com a clínica pelo telefone ${ctx.phone} ou escreva "atendente".`
    : 'Escreva "atendente" para falar com a nossa equipe.'
  return {
    reply: [
      "Não posso dar orientações de saúde por aqui — isso precisa ser avaliado por um profissional.",
      contato,
      "Em caso de urgência, procure o atendimento de saúde mais próximo.",
    ].join("\n"),
    nextState: "MENU",
    needsAttention: false,
  }
}

const RESPOSTA_OBRIGADO = 'De nada! Estou aqui para ajudar. Escreva "menu" para ver as opções.'
const RESPOSTA_OK = 'Perfeito! Se precisar de mais alguma coisa, escreva "menu".'
const RESPOSTA_TCHAU = "Até logo! Qualquer coisa, é só chamar."

/**
 * Decide a resposta do bot.
 *
 * Ordem de checagem: fluxo do CPF em andamento → opções numeradas →
 * intents por palavra-chave (remarcar antes de agendar, pois "remarcar"
 * contém "marcar") → saúde (segurança) → saudação/conversa → fallback.
 */
export function runBot(
  state: BotState,
  rawText: string,
  ctx: BotContext
): BotResult {
  const text = normalizeText(rawText)
  const digits = extractDigits(text)
  if (!text) {
    return { reply: menuReply(ctx), nextState: "MENU", needsAttention: false }
  }

  // 1) Paciente estava no fluxo "envie seu CPF"
  if (state === "AGUARDANDO_CPF") {
    if (digits.length === 11) {
      return {
        reply: "", // o serviço monta a resposta com as consultas
        nextState: "MENU",
        needsAttention: false,
        cpfLookup: digits,
      }
    }
    if (hasAny(text, ["menu", "voltar", "sair", "cancelar"])) {
      return { reply: menuReply(ctx), nextState: "MENU", needsAttention: false }
    }
    if (digits.length > 0) {
      return {
        reply:
          "Este CPF está incompleto. O CPF tem 11 números — confira e envie de novo.\nPara voltar ao menu, escreva \"menu\".",
        nextState: "AGUARDANDO_CPF",
        needsAttention: false,
      }
    }
    return {
      reply: 'Envie apenas os 11 números do seu CPF.\nPara voltar ao menu, escreva "menu".',
      nextState: "AGUARDANDO_CPF",
      needsAttention: false,
    }
  }

  // 2) Opções numeradas do menu (texto exatamente "1".."7")
  if (digits.length === 1 && text === digits) {
    switch (digits) {
      case "1":
        return respostaAgendar(ctx)
      case "2":
        return pedirCpf(
          ctx,
          "Para consultar seus agendamentos, me envie o seu CPF."
        )
      case "3":
        return pedirCpf(
          ctx,
          "Para remarcar uma consulta, me envie o seu CPF."
        )
      case "4":
        return respostaEndereco(ctx)
      case "5":
        return respostaHorario(ctx)
      case "6":
        return respostaContato(ctx)
      case "7":
        return respostaAtendente(ctx)
    }
  }

  // 3) Remarcar (antes de "marcar", que é parte de "remarcar")
  if (hasAny(text, ["remarcar", "desmarcar", "cancelar", "alterar", "mudar"])) {
    return pedirCpf(
      ctx,
      "Para remarcar uma consulta, me envie o seu CPF."
    )
  }

  // 4) Agendar
  if (
    hasAny(text, [
      "agendar",
      "marcar",
      "nova consulta",
      "horario disponivel",
      "vaga",
      "disponivel",
    ])
  ) {
    return respostaAgendar(ctx)
  }

  // 5) Ver minha consulta
  if (
    hasAny(text, [
      "minha consulta",
      "minhas consultas",
      "meu agendamento",
      "quando e minha",
      "ver minha",
      "ver meu",
      "minha data",
      "meu horario",
    ])
  ) {
    return pedirCpf(
      ctx,
      "Para consultar seus agendamentos, me envie o seu CPF."
    )
  }

  // 6) Endereço
  if (
    hasAny(text, [
      "endereco",
      "onde fica",
      "onde e",
      "local",
      "localizacao",
      "chegar",
    ])
  ) {
    return respostaEndereco(ctx)
  }

  // 7) Falar com um humano (antes de "horário", pois "atendente" contém "atende")
  if (
    hasAny(text, [
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
    ])
  ) {
    return respostaAtendente(ctx)
  }

  // 8) Horário de atendimento
  if (
    hasAny(text, [
      "horario",
      "funciona",
      "funcionamento",
      "aberto",
      "abre",
      "fecha",
      "atende",
    ])
  ) {
    return respostaHorario(ctx)
  }

  // 9) Telefone/contato
  if (hasAny(text, ["telefone", "contato", "email", "e-mail", "ligar", "ligacao"])) {
    return respostaContato(ctx)
  }

  // 10) Saúde: o bot nunca dá orientação médica
  if (
    hasAny(text, [
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
    ])
  ) {
    return respostaSaude(ctx)
  }

  // 11) Saudação
  if (
    hasAny(text, ["bom dia", "boa tarde", "boa noite", "tudo bem", "tudo bom"]) ||
    /^(oi|ola|hey|opa|eai|e ai)(\s|$)/.test(text)
  ) {
    return { reply: menuReply(ctx), nextState: "MENU", needsAttention: false }
  }

  // 12) Conversa leve
  if (hasAny(text, ["obrigado", "obrigada", "valeu", "agradecido", "grato"])) {
    return { reply: RESPOSTA_OBRIGADO, nextState: "MENU", needsAttention: false }
  }
  if (hasAny(text, ["ok", "certo", "beleza", "blz", "ta bom", "tudo certo"])) {
    return { reply: RESPOSTA_OK, nextState: "MENU", needsAttention: false }
  }
  if (hasAny(text, ["tchau", "ate mais", "ate logo", "adeus"])) {
    return { reply: RESPOSTA_TCHAU, nextState: "MENU", needsAttention: false }
  }

  // 13) "menu" explícito
  if (text === "menu" || hasAny(text, ["opcoes", "inicio"])) {
    return { reply: menuReply(ctx), nextState: "MENU", needsAttention: false }
  }

  // 14) Fallback
  return {
    reply: [
      "Não entendi sua mensagem. Posso ajudar com:",
      "",
      ...OPCOES_MENU,
      "",
      'Se preferir, escreva "atendente" para falar com a nossa equipe.',
    ].join("\n"),
    nextState: "MENU",
    needsAttention: false,
  }
}
