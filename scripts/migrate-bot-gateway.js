/**
 * One-off idempotente: adiciona o portão de identificação (PEDIR_NOME →
 * PORTAO → "já sou paciente" / "primeira consulta") ao fluxo BOT salvo no
 * banco, preservando os nós/arestas existentes (posições só são deslocadas
 * para abrir espaço). Se o fluxo já tiver um nó PEDIR_NOME, não faz nada.
 *
 * Rodar na VPS após o deploy:
 *
 *   docker compose run --rm --no-deps \
 *     -v /opt/clinica-medica/scripts/migrate-bot-gateway.js:/tmp/migrate.js:ro \
 *     -T app sh -c 'cd /app && NODE_PATH=/app/node_modules node /tmp/migrate.js'
 */
const { PrismaClient } = require("@prisma/client")

const TEXTS = {
  pedirNome: [
    "Olá! 👋 Seja bem-vindo(a) à {{clinica}}!",
    "Antes de começar, como posso te chamar?",
  ].join("\n"),
  portao:
    "Obrigado, {{nome}}! Você já é paciente ou é o primeiro atendimento?",
  primeiraConsulta: [
    "Que ótimo! Para agendar sua primeira consulta, é bem rápido:",
    "",
    "1. Acesse: {{link_lead}}",
    "2. Seu nome e telefone já chegam preenchidos — complete o restante.",
    "",
    'Se preferir, escreva "atendente" para falar com a nossa equipe.',
  ].join("\n"),
}

async function main() {
  const prisma = new PrismaClient()
  try {
    const flow = await prisma.messageFlow.findFirst({ where: { kind: "BOT" } })
    if (!flow) {
      console.log("Fluxo BOT não encontrado no banco — nada a migrar.")
      return
    }

    const nodes = Array.isArray(flow.nodes) ? flow.nodes : []
    const edges = Array.isArray(flow.edges) ? flow.edges : []

    if (nodes.some((n) => n && n.kind === "PEDIR_NOME")) {
      console.log("Fluxo BOT já tem o portão (PEDIR_NOME) — nada a migrar.")
      return
    }

    const trigger = nodes.find((n) => n && n.kind === "GATILHO")
    if (!trigger) {
      console.log("Fluxo BOT sem nó de gatilho — migração abortada.")
      return
    }
    const triggerEdge = edges.find((e) => e && e.source === trigger.id)
    const oldRootId = triggerEdge ? triggerEdge.target : null
    if (!oldRootId) {
      console.log("Fluxo BOT sem nó inicial — migração abortada.")
      return
    }

    // Abre espaço para o portão: desloca os nós existentes (menos o
    // gatilho) para a direita/baixo, preservando o desenho atual.
    const shiftX = 400
    const shiftY = 300
    const shifted = nodes.map((n) =>
      n && n.id !== trigger.id && n.position
        ? { ...n, position: { x: n.position.x + shiftX, y: n.position.y + shiftY } }
        : n
    )

    const rootY = typeof trigger.position?.y === "number" ? trigger.position.y : 300
    const newNodes = [
      { id: "pedir_nome", kind: "PEDIR_NOME", content: TEXTS.pedirNome, position: { x: 360, y: rootY } },
      { id: "portao", kind: "PORTAO", content: TEXTS.portao, position: { x: 720, y: rootY } },
      { id: "ramo_g_paciente", kind: "RAMO", label: "Já sou paciente", keywords: ["ja sou paciente", "sou paciente"], optionNumber: 1, position: { x: 1080, y: rootY - 160 } },
      { id: "ramo_g_consulta", kind: "RAMO", label: "Primeira consulta", keywords: ["primeira consulta", "quero agendar", "quero marcar"], optionNumber: 2, position: { x: 1080, y: rootY } },
      { id: "ramo_g_fallback", kind: "RAMO", label: "Qualquer outra mensagem", keywords: [], optionNumber: null, position: { x: 1080, y: rootY + 160 } },
      { id: "acao_cpf_portao", kind: "ACAO", acao: "PEDIR_CPF", position: { x: 1440, y: rootY - 160 } },
      { id: "msg_primeira_consulta", kind: "MENSAGEM", content: TEXTS.primeiraConsulta, mediaUrl: null, mediaType: null, position: { x: 1440, y: rootY } },
    ]
    const newEdges = [
      { id: "e_g_nome", source: "pedir_nome", target: "portao" },
      { id: "e_g_paciente", source: "portao", target: "ramo_g_paciente" },
      { id: "e_g_consulta", source: "portao", target: "ramo_g_consulta" },
      { id: "e_g_fallback", source: "portao", target: "ramo_g_fallback" },
      { id: "e_g_cpf", source: "ramo_g_paciente", target: "acao_cpf_portao" },
      { id: "e_g_msg", source: "ramo_g_consulta", target: "msg_primeira_consulta" },
      { id: "e_g_menu", source: "ramo_g_fallback", target: oldRootId },
    ]

    // O gatilho passa a apontar para o portão (pedir nome).
    const rewired = edges.map((e) =>
      e && e.source === trigger.id ? { ...e, target: "pedir_nome" } : e
    )

    const nextNodes = [...shifted, ...newNodes]
    const nextEdges = [...rewired, ...newEdges]

    await prisma.messageFlow.update({
      where: { id: flow.id },
      data: { nodes: nextNodes, edges: nextEdges },
    })

    console.log(
      `✓ Fluxo BOT atualizado: ${newNodes.length} nós novos do portão; gatilho → pedir_nome → portao → ${oldRootId}.`
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
