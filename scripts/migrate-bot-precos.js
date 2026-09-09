/**
 * One-off idempotente: reescreve a entrada do fluxo BOT salvo no banco
 * para o novo primeiro atendimento com preços:
 *
 *   gatilho → portão de preços ({{precos}} + botões de modalidade)
 *           → ramo "Consulta domiciliar" / "Teleconsulta" → pedir nome
 *           → mensagem da agenda ({{link_cadastro}}); fallback → menu.
 *
 * Remove o portão antigo ("já é paciente ou primeira consulta?") e seus
 * nós/arestas, preservando o menu e o restante do fluxo. O texto de
 * preços e os botões vêm do código (motor + serviço) — este script só
 * ajusta a estrutura do grafo.
 *
 * Rodar na VPS após o deploy:
 *
 *   docker compose run --rm --no-deps \
 *     -v /opt/clinica-medica/scripts/migrate-bot-precos.js:/tmp/migrate.js:ro \
 *     -T app sh -c 'cd /app && NODE_PATH=/app/node_modules node /tmp/migrate.js'
 */
const { PrismaClient } = require("@prisma/client")

const PORTAO_CONTENT = [
  "Olá! 👋 Seja bem-vindo(a) à {{clinica}}!",
  "",
  "{{precos}}",
  "",
  "Qual consulta você prefere? Escolha uma das opções abaixo:",
].join("\n")

const PEDIR_NOME_CONTENT =
  "Perfeito! Para o agendamento, me diz seu nome completo, por favor."

const MSG_AGENDA_CONTENT = [
  "Perfeito, {{nome}}! Vou te enviar a agenda para você escolher o melhor dia e horário da sua consulta:",
  "",
  "{{link_cadastro}}",
].join("\n")

/** Ids dos nós do portão antigo que saem do fluxo. */
const REMOVED_NODE_IDS = [
  "msg_primeira_consulta",
  "acao_cpf_portao",
  "ramo_g_paciente",
  "ramo_g_consulta",
  "ramo_g_fallback",
]

/** Ids das arestas antigas do portão que saem do fluxo. */
const REMOVED_EDGE_IDS = [
  "e_gatilho",
  "e_g_nome",
  "e_g_paciente",
  "e_g_consulta",
  "e_g_fallback",
  "e_g_cpf",
  "e_g_msg",
  "e_g_menu",
]

const NEW_NODES = [
  {
    id: "msg_agenda",
    kind: "MENSAGEM",
    content: MSG_AGENDA_CONTENT,
    showOptions: null,
    mediaUrl: null,
    mediaType: null,
    position: { x: 1800, y: 460 },
  },
  {
    id: "ramo_g_domiciliar",
    kind: "RAMO",
    label: "Consulta domiciliar",
    keywords: ["domiciliar", "casa", "em casa", "visita"],
    optionNumber: 1,
    position: { x: 1080, y: 140 },
  },
  {
    id: "ramo_g_tele",
    kind: "RAMO",
    label: "Teleconsulta",
    keywords: ["teleconsulta", "tele", "video", "online", "remoto", "virtual"],
    optionNumber: 2,
    position: { x: 1080, y: 460 },
  },
  {
    id: "ramo_g_fallback",
    kind: "RAMO",
    label: "Qualquer outra mensagem",
    keywords: [],
    optionNumber: null,
    position: { x: 1080, y: 780 },
  },
]

const NEW_EDGES = [
  { id: "e_gatilho", source: "gatilho", target: "portao" },
  { id: "e_g_dom", source: "portao", target: "ramo_g_domiciliar" },
  { id: "e_g_tele", source: "portao", target: "ramo_g_tele" },
  { id: "e_g_fallback", source: "portao", target: "ramo_g_fallback" },
  { id: "e_g_dom_nome", source: "ramo_g_domiciliar", target: "pedir_nome" },
  { id: "e_g_tele_nome", source: "ramo_g_tele", target: "pedir_nome" },
  { id: "e_nome_agenda", source: "pedir_nome", target: "msg_agenda" },
  { id: "e_g_menu", source: "ramo_g_fallback", target: "menu" },
]

async function main() {
  const prisma = new PrismaClient()
  try {
    const flow = await prisma.messageFlow.findFirst({ where: { kind: "BOT" } })
    if (!flow) {
      console.log("Fluxo BOT não encontrado no banco — nada a migrar.")
      return
    }

    const nodes = Array.isArray(flow.nodes) ? flow.nodes : []
    if (nodes.some((n) => n && n.id === "msg_agenda")) {
      console.log("Portão de preços já presente no fluxo — nada a migrar.")
      return
    }

    // Atualiza o portão e o pedido de nome já existentes com os novos
    // textos; remove os nós do portão antigo; acrescenta os novos nós.
    const nextNodes = nodes
      .filter((n) => n && !REMOVED_NODE_IDS.includes(n.id))
      .map((n) => {
        if (n.id === "portao") {
          return {
            ...n,
            content: PORTAO_CONTENT,
            position: { x: 720, y: 300 },
          }
        }
        if (n.id === "pedir_nome") {
          return {
            ...n,
            content: PEDIR_NOME_CONTENT,
            position: { x: 1440, y: 460 },
          }
        }
        return n
      })
    nextNodes.push(...NEW_NODES)

    const edges = Array.isArray(flow.edges) ? flow.edges : []
    const nextEdges = edges.filter(
      (e) => e && !REMOVED_EDGE_IDS.includes(e.id)
    )
    nextEdges.push(...NEW_EDGES)

    await prisma.messageFlow.update({
      where: { id: flow.id },
      data: { nodes: nextNodes, edges: nextEdges },
    })

    console.log(
      `✓ Fluxo BOT atualizado: portão de preços no lugar do portão antigo (${nextNodes.length} nós, ${nextEdges.length} arestas).`
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
