/**
 * Migração idempotente: traduz o comportamento atual de mensagens
 * (bot + automações + jornadas) para fluxos no painel (MessageFlow).
 *
 * - Fluxo BOT: regras históricas do bot com os textos atuais de
 *   ClinicSettings (buildBotFlow).
 * - Fluxos AUTOMACAO (12): textos, enabled e configurações atuais de
 *   ClinicSettings viram GATILHO/MENSAGEM no grafo.
 * - Fluxos JORNADA: cada MessageJourney existente vira um fluxo com
 *   GATILHO inicio_manual → MENSAGEMs (mediaUrl/mediaType) com arestas
 *   delayMinutes = delayHours * 60.
 *
 * Não sobrescreve fluxos já existentes (roda só na primeira vez; pode ser
 * executada de novo com segurança).
 *
 * Executar com: npx tsx scripts/migrate-flows.ts
 */
import { Prisma, PrismaClient, FlowKind } from "@prisma/client"
import type { FlowEdge, FlowNode, GatilhoTipo } from "../lib/whatsapp/flow-types"
import { buildBotFlow } from "../lib/whatsapp/flow-defaults"

const prisma = new PrismaClient()

type RawJourney = {
  id: string
  name: string
  description: string | null
  active: boolean
  createdAt: Date
}

type RawStep = {
  id: string
  journeyId: string
  position: number
  delayHours: number
  kind: "TEXTO" | "IMAGEM" | "VIDEO"
  content: string
  mediaUrl: string | null
}

// ---------------------------------------------------------------------------
// Textos padrão (idênticos aos defaults do motor — fonte do seed).
// ---------------------------------------------------------------------------

function defaultAutomationMessage(
  kind:
    | "tratamento"
    | "aniversario"
    | "reativacao"
    | "agradecimento"
    | "acaminho"
    | "linkpagamento"
    | "lembretepagamento"
    | "pagamentoconfirmado"
): string {
  switch (kind) {
    case "tratamento":
      return "Olá {{nome}}! Aqui é da {{clinica}}. Esperamos que esteja tudo bem com você. Qualquer dúvida sobre o seu tratamento, é só responder por aqui."
    case "aniversario":
      return "Olá {{nome}}! A equipe da {{clinica}} deseja um feliz aniversário! Muita saúde e um excelente ano novo de vida. 🎉"
    case "reativacao":
      return "Olá {{nome}}! Faz um tempo que não nos vemos. Que tal agendar uma consulta para cuidar da sua saúde? É só responder por aqui."
    case "agradecimento":
      return "Olá {{nome}}! Obrigado pela sua visita. Sua opinião é muito importante para nós — se precisar de algo, é só responder por aqui."
    case "acaminho":
      return "Olá {{nome}}! O médico já está a caminho da sua casa."
    case "linkpagamento":
      return "Olá {{nome}}! Reservamos seu horário. Para confirmar a consulta, faça o pagamento de R$ {{valor}} por aqui: {{link}}"
    case "lembretepagamento":
      return "Olá {{nome}}! Seu horário ainda está reservado, mas falta o pagamento de R$ {{valor}} para confirmar a consulta. Pague por aqui: {{link}}"
    case "pagamentoconfirmado":
      return "Olá {{nome}}! Recebemos seu pagamento de R$ {{valor}}. Tudo certo!"
  }
}

function defaultCadastroFollowUpMessage(stage: 1 | 2 | 3): string {
  switch (stage) {
    case 1:
      return "Olá {{nome}}! 😊 Seu cadastro ficou no meio do caminho, mas sua saúde não precisa esperar. Faltam poucos passos para garantir sua consulta. Continue por aqui: {{link}}"
    case 2:
      return "Oi {{nome}}! 💙 Cuidar da saúde é o melhor presente que você pode se dar hoje. Sua consulta está a poucos cliques — vamos concluir seu cadastro? {{link}}"
    case 3:
      return "{{nome}}, deixar a saúde para depois pode sair caro. 🩺 Nossa equipe está pronta para cuidar de você — termine seu cadastro em 2 minutinhos e garanta seu horário: {{link}}"
  }
}

function defaultWhatsappFollowUpMessage(stage: 1 | 2 | 3): string {
  switch (stage) {
    case 1:
      return "Oi! 😊 Você falou com a gente aqui no WhatsApp e sumiu — mas a sua saúde não precisa esperar. Que tal agendar sua consulta? É rapidinho: {{link}}"
    case 2:
      return "Cuidar de você é o melhor investimento de hoje. 💙 A {{clinica}} está pronta para te atender — garanta seu horário em 2 minutinhos: {{link}}"
    case 3:
      return "Deixar a saúde para depois pode sair caro. 🩺 Nossa equipe está esperando por você — agende agora: {{link}}"
  }
}

function defaultFollowUpMessage(): string {
  return "Olá {{nome}}! 😊 Seu horário continua reservado. Para confirmar a consulta, falta o pagamento de R$ {{valor}} — é rapidinho por aqui: {{link}}"
}

function defaultCanceladoMessage(): string {
  return "Olá {{nome}}! 😔 Como não identificamos o pagamento da sua consulta de {{data}} às {{hora}}, a reserva foi liberada. Não se preocupe: é só agendar de novo por aqui: {{link}}"
}

// ---------------------------------------------------------------------------
// Construtores de nós/arestas
// ---------------------------------------------------------------------------

function gatilho(
  gatilhoType: GatilhoTipo,
  config?: Record<string, unknown>
): FlowNode {
  return {
    id: "gatilho",
    kind: "GATILHO",
    gatilho: gatilhoType,
    config,
    position: { x: 0, y: 120 },
  }
}

function mensagem(
  id: string,
  content: string,
  y: number,
  media?: { url: string; type: "IMAGEM" | "VIDEO" }
): FlowNode {
  return {
    id,
    kind: "MENSAGEM",
    content,
    mediaUrl: media?.url ?? null,
    mediaType: media?.type ?? null,
    position: { x: 300, y },
  }
}

function edge(id: string, source: string, target: string, delayMinutes?: number): FlowEdge {
  return { id, source, target, delayMinutes }
}

/**
 * Monta uma automação de mensagem única:
 * GATILHO → MENSAGEM (conteúdo atual de ClinicSettings ou padrão).
 */
function singleMessageFlow(
  name: string,
  description: string,
  gatilhoType: GatilhoTipo,
  content: string | null | undefined,
  fallback: string,
  enabled: boolean,
  config?: Record<string, unknown>
): { kind: FlowKind; name: string; description: string; enabled: boolean; nodes: FlowNode[]; edges: FlowEdge[] } {
  return {
    kind: "AUTOMACAO",
    name,
    description,
    enabled,
    nodes: [gatilho(gatilhoType, config), mensagem("msg1", content?.trim() || fallback, 120)],
    edges: [edge("e1", "gatilho", "msg1")],
  }
}

/** Automação com 3 mensagens encadeadas (follow-ups de 30min/1h/2h). */
function stagedFlow(
  name: string,
  description: string,
  gatilhoType: GatilhoTipo,
  contents: Array<string | null | undefined>,
  fallbacks: [string, string, string],
  enabled: boolean,
  config?: Record<string, unknown>
): { kind: FlowKind; name: string; description: string; enabled: boolean; nodes: FlowNode[]; edges: FlowEdge[] } {
  return {
    kind: "AUTOMACAO",
    name,
    description,
    enabled,
    nodes: [
      gatilho(gatilhoType, config),
      mensagem("msg1", contents[0]?.trim() || fallbacks[0], 120),
      mensagem("msg2", contents[1]?.trim() || fallbacks[1], 320),
      mensagem("msg3", contents[2]?.trim() || fallbacks[2], 520),
    ],
    edges: [
      edge("e1", "gatilho", "msg1", 30),
      edge("e2", "msg1", "msg2", 30),
      edge("e3", "msg2", "msg3", 60),
    ],
  }
}

async function main() {
  console.log("Migrando mensagens para fluxos (MessageFlow)...")

  const clinic = await prisma.clinicSettings.findUnique({ where: { id: 1 } })
  if (!clinic) throw new Error("ClinicSettings não encontrado (id=1)")

  const existing = await prisma.messageFlow.findMany()
  const existingTriggers = new Set<string>()
  let hasBot = false
  let hasJourney = false
  for (const row of existing) {
    if (row.kind === "BOT") hasBot = true
    if (row.kind === "JORNADA") hasJourney = true
    if (row.kind === "AUTOMACAO") {
      const nodes = row.nodes as unknown as FlowNode[]
      const trigger = nodes.find((n) => n.kind === "GATILHO")
      if (trigger && trigger.kind === "GATILHO") existingTriggers.add(trigger.gatilho)
    }
  }

  let created = 0

  // 1) Fluxo BOT (único, com os textos atuais de ClinicSettings)
  if (!hasBot) {
    const botFlow = buildBotFlow({
      boasVindas: clinic.botMsgBoasVindas,
      agendar: clinic.botMsgAgendar,
      atendente: clinic.botMsgAtendente,
      saude: clinic.botMsgSaude,
      phone: clinic.phone,
    })
    await prisma.messageFlow.create({
      data: {
        kind: "BOT",
        name: "Bot de atendimento",
        description:
          "Menu de opções e intents por palavra-chave do assistente virtual. Fluxo único, não pode ser excluído.",
        enabled: true,
        nodes: botFlow.nodes as unknown as Prisma.InputJsonValue,
        edges: botFlow.edges as unknown as Prisma.InputJsonValue,
      },
    })
    created++
    console.log("✓ Fluxo BOT criado")
  } else {
    console.log("• Fluxo BOT já existe — mantido")
  }

  // 2) Fluxos AUTOMACAO (textos e configurações atuais de ClinicSettings)
  const automations: Array<{
    gatilho: GatilhoTipo
    data: { kind: FlowKind; name: string; description: string; enabled: boolean; nodes: FlowNode[]; edges: FlowEdge[] }
  }> = [
    {
      gatilho: "cadastro_incompleto",
      data: stagedFlow(
        "Cadastro incompleto",
        "Lembretes para quem iniciou o cadastro online e não finalizou (30 min, 1h e 2h).",
        "cadastro_incompleto",
        [clinic.autoCadastroMsg, clinic.autoCadastroFollowUp2Msg, clinic.autoCadastroFollowUp3Msg],
        [defaultCadastroFollowUpMessage(1), defaultCadastroFollowUpMessage(2), defaultCadastroFollowUpMessage(3)],
        clinic.autoCadastroEnabled
      ),
    },
    {
      gatilho: "whatsapp_contato",
      data: stagedFlow(
        "Contato pelo WhatsApp",
        "Lembretes para quem mandou mensagem no WhatsApp e ficou em silêncio (30 min, 1h e 2h).",
        "whatsapp_contato",
        [clinic.autoWhatsappFollowUpMsg, clinic.autoWhatsappFollowUp2Msg, clinic.autoWhatsappFollowUp3Msg],
        [defaultWhatsappFollowUpMessage(1), defaultWhatsappFollowUpMessage(2), defaultWhatsappFollowUpMessage(3)],
        clinic.autoWhatsappFollowUpEnabled
      ),
    },
    {
      gatilho: "tratamento_periodico",
      data: singleMessageFlow(
        "Tratamento periódico",
        "Mensagem periódica para pacientes com consulta realizada nos últimos 90 dias.",
        "tratamento_periodico",
        clinic.autoTratamentoMsg,
        defaultAutomationMessage("tratamento"),
        clinic.autoTratamentoEnabled,
        { intervalDays: clinic.autoTratamentoIntervalDays ?? 7 }
      ),
    },
    {
      gatilho: "aniversario",
      data: singleMessageFlow(
        "Aniversário",
        "Mensagem de parabéns no dia do aniversário do paciente (1x por ano).",
        "aniversario",
        clinic.autoAniversarioMsg,
        defaultAutomationMessage("aniversario"),
        clinic.autoAniversarioEnabled
      ),
    },
    {
      gatilho: "reativacao",
      data: singleMessageFlow(
        "Reativação",
        "Mensagem para clientes sem consulta há X dias (config: days).",
        "reativacao",
        clinic.autoReativacaoMsg,
        defaultAutomationMessage("reativacao"),
        clinic.autoReativacaoEnabled,
        { days: clinic.autoReativacaoDays ?? 60 }
      ),
    },
    {
      gatilho: "agradecimento",
      data: singleMessageFlow(
        "Pós-consulta (agradecimento)",
        "Agradecimento enviado ao finalizar a consulta.",
        "agradecimento",
        clinic.autoAgradecimentoMsg,
        defaultAutomationMessage("agradecimento"),
        clinic.autoAgradecimentoEnabled
      ),
    },
    {
      gatilho: "acaminho",
      data: singleMessageFlow(
        "Médico a caminho",
        "Aviso enviado ao iniciar o atendimento presencial/domiciliar.",
        "acaminho",
        clinic.autoACaminhoMsg,
        defaultAutomationMessage("acaminho"),
        clinic.autoACaminhoEnabled
      ),
    },
    {
      gatilho: "link_pagamento",
      data: singleMessageFlow(
        "Link de pagamento",
        "Link enviado ao reservar o horário com cobrança.",
        "link_pagamento",
        clinic.autoPagamentoLinkMsg,
        defaultAutomationMessage("linkpagamento"),
        clinic.autoPagamentoLinkEnabled
      ),
    },
    {
      gatilho: "lembrete_pagamento",
      data: singleMessageFlow(
        "Lembrete de pagamento",
        "Lembrete para quem reservou e não pagou (config: delayMinutes).",
        "lembrete_pagamento",
        clinic.autoPagamentoLembreteMsg,
        defaultAutomationMessage("lembretepagamento"),
        clinic.autoPagamentoLembreteEnabled,
        { delayMinutes: clinic.autoPagamentoLembreteDelayMinutes ?? 60 }
      ),
    },
    {
      gatilho: "pagamento_confirmado",
      data: singleMessageFlow(
        "Pagamento confirmado",
        "Aviso de recebimento enviado na confirmação do pagamento.",
        "pagamento_confirmado",
        clinic.autoPagamentoConfirmadoMsg,
        defaultAutomationMessage("pagamentoconfirmado"),
        clinic.autoPagamentoConfirmadoEnabled
      ),
    },
    {
      gatilho: "agendamento_followup",
      data: stagedFlow(
        "Follow-up de agendamento",
        "Lembretes de pagamento da reserva online (30 min, 1h e 2h); sem pagamento após o último, a reserva é liberada.",
        "agendamento_followup",
        [clinic.autoAgendamentoFollowUpMsg, clinic.autoAgendamentoFollowUpMsg, clinic.autoAgendamentoFollowUpMsg],
        [defaultFollowUpMessage(), defaultFollowUpMessage(), defaultFollowUpMessage()],
        clinic.autoAgendamentoFollowUpEnabled
      ),
    },
    {
      gatilho: "agendamento_cancelado",
      data: singleMessageFlow(
        "Reserva liberada (sem pagamento)",
        "Aviso enviado quando a reserva online é liberada por falta de pagamento.",
        "agendamento_cancelado",
        clinic.autoAgendamentoCanceladoMsg,
        defaultCanceladoMessage(),
        clinic.autoAgendamentoFollowUpEnabled
      ),
    },
  ]

  for (const { gatilho: g, data } of automations) {
    if (existingTriggers.has(g)) {
      console.log(`• Automação "${g}" já existe — mantida`)
      continue
    }
    await prisma.messageFlow.create({
      data: {
        ...data,
        nodes: data.nodes as unknown as Prisma.InputJsonValue,
        edges: data.edges as unknown as Prisma.InputJsonValue,
      },
    })
    created++
    console.log(`✓ Automação "${g}" criada`)
  }

  // 3) Jornadas existentes → fluxos JORNADA
  if (!hasJourney) {
    const journeys = await prisma.$queryRaw<RawJourney[]>`
      SELECT "id", "name", "description", "active", "createdAt" FROM "MessageJourney" ORDER BY "createdAt" ASC
    `
    const steps = await prisma.$queryRaw<RawStep[]>`
      SELECT "id", "journeyId", "position", "delayHours", "kind", "content", "mediaUrl" FROM "JourneyStep" ORDER BY "journeyId" ASC, "position" ASC
    `
    for (const journey of journeys) {
      const journeySteps = steps
        .filter((s) => s.journeyId === journey.id)
        .sort((a, b) => a.position - b.position)
      if (journeySteps.length === 0) continue

      const nodes: FlowNode[] = [gatilho("inicio_manual")]
      const edges: FlowEdge[] = []
      let previousId = "gatilho"
      journeySteps.forEach((step, index) => {
        const id = `msg${index + 1}`
        const isMedia = step.kind !== "TEXTO"
        nodes.push(
          mensagem(id, step.content, 120 + index * 200, isMedia && step.mediaUrl
            ? { url: step.mediaUrl, type: step.kind === "IMAGEM" ? "IMAGEM" : "VIDEO" }
            : undefined)
        )
        edges.push(
          edge(`e${index + 1}`, previousId, id, Math.round(step.delayHours * 60))
        )
        previousId = id
      })

      await prisma.messageFlow.create({
        data: {
          kind: "JORNADA",
          name: journey.name,
          description: journey.description,
          enabled: journey.active,
          nodes: nodes as unknown as Prisma.InputJsonValue,
          edges: edges as unknown as Prisma.InputJsonValue,
        },
      })
      created++
      console.log(`✓ Jornada "${journey.name}" migrada (${journeySteps.length} passos)`)
    }
    if (journeys.length > 0 && created === 0) {
      console.log("• Nenhuma jornada pendente para migrar")
    }
  } else {
    console.log("• Já existem fluxos de jornada — conversão ignorada")
  }

  console.log(`Migração concluída: ${created} fluxo(s) criado(s).`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
