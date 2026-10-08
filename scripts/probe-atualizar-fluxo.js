/**
 * Atualiza o fluxo BOT em produção conforme pedido da clínica:
 *
 * 1️⃣ Quero saber como funciona            → vídeo boas-vindas.mp4
 * 2️⃣ Quero saber os valores do investimento → tabela de valores fixa
 * 3️⃣ Agendar uma consulta 📅               → link da agenda
 * 4️⃣ Remarcar consulta 🔁                  → pedir CPF
 * 5️⃣ Horário de atendimento                → horário da clínica
 * 6️⃣ Falar com um atendente 👩‍⚕️            → pausa o bot e avisa a equipe
 *
 * Preserva todos os demais nós (portão, ramos por palavra-chave, ações).
 */
const fs = require("fs")
const path = require("path")

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8")
const match = env.match(/^DATABASE_URL=["']?([^"'\r\n]+)/m)
if (!match) throw new Error("DATABASE_URL não encontrada no .env")
let url = match[1].replace(":5432", ":6543")
if (!url.includes("pgbouncer=true")) {
  url += (url.includes("?") ? "&" : "?") + "pgbouncer=true"
}
process.env.DATABASE_URL = url

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const VIDEO_URL = "https://painel.medicoemdomicilio.com/boas-vindas.mp4"

const VIDEO_CAPTION = [
  "Que bom te ver por aqui! 😊",
  "Assista ao vídeo e entenda como funciona o nosso atendimento:",
].join("\n")

const INVESTIMENTO_TEXT = [
  "Valor do investimento:",
  "",
  "CONSULTAS PRESENCIAIS:",
  "",
  "Bairros: Cidade Nova, Jardim União, Novo Horizonte, Independência, Liberdade, Nova Marabá e Velha Marabá:",
  "R$ 500,00",
  "",
  "Bairros Cidade Jardim, São Félix e Morada Nova:",
  "R$ 550,00",
  "",
  "Telemedicina (consulta on-line):",
  "R$ 450,00",
].join("\n")

const COMO_FUNCIONA_KW = [
  "como funciona",
  "como voces funcionam",
  "como voces trabalham",
  "como e o atendimento",
]

async function main() {
  const flow = await prisma.messageFlow.findFirst({ where: { kind: "BOT" } })
  if (!flow) throw new Error("Fluxo BOT não encontrado no banco")

  const nodes = Array.isArray(flow.nodes) ? [...flow.nodes] : []
  const edges = Array.isArray(flow.edges) ? [...flow.edges] : []
  const out = []
  const log = (msg) => out.push(msg)

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const update = (id, patch, create) => {
    const node = byId.get(id)
    if (node) {
      Object.assign(node, patch)
      log(`node ${id}: atualizado`)
    } else if (create) {
      const novo = { id, ...create, ...patch }
      nodes.push(novo)
      byId.set(id, novo)
      log(`node ${id}: criado`)
    }
  }

  // --- Ramos numerados do menu (ordem pedida pela clínica) ---
  update("ramo_op1", {
    label: "Quero saber como funciona",
    keywords: COMO_FUNCIONA_KW,
    optionNumber: 1,
  })
  update("ramo_op2", {
    label: "Quero saber os valores do investimento",
    keywords: [],
    optionNumber: 2,
  })
  update("ramo_op3", {
    label: "Agendar uma consulta 📅",
    keywords: [],
    optionNumber: 3,
  })
  update("ramo_op4", {
    label: "Remarcar consulta 🔁",
    keywords: [],
    optionNumber: 4,
  })
  update("ramo_op5", {
    label: "Horário de atendimento",
    keywords: [],
    optionNumber: 5,
  })
  update(
    "ramo_op6",
    { label: "Falar com um atendente 👩‍⚕️", keywords: [], optionNumber: 6 },
    { kind: "RAMO", position: { x: 2160, y: 660 } }
  )

  // Keywords: ramo de valores passa a reconhecer "investimento".
  const ramoValores = byId.get("ramo_valores")
  if (ramoValores && Array.isArray(ramoValores.keywords) && !ramoValores.keywords.includes("investimento")) {
    ramoValores.keywords.push("investimento")
    log("node ramo_valores: keyword 'investimento' adicionada")
  }

  // --- Nós de resposta novos ---
  update(
    "resp_como_funciona",
    {
      content: VIDEO_CAPTION,
      mediaUrl: VIDEO_URL,
      mediaType: "VIDEO",
      showOptions: true,
    },
    { kind: "MENSAGEM", position: { x: 2880, y: 60 } }
  )
  update(
    "resp_investimento",
    { content: INVESTIMENTO_TEXT, showOptions: true },
    { kind: "MENSAGEM", position: { x: 2880, y: 1200 } }
  )

  // --- Arestas ---
  const isMenuOpEdge = (e) => e.source === "menu" && /^ramo_op[1-5]$/.test(e.target)
  const isOldOpEdge = (e) => /^ramo_op[1-5]$/.test(e.source)
  const rest = edges.filter((e) => !isMenuOpEdge(e) && !isOldOpEdge(e))
  const menuRest = rest.filter((e) => e.source === "menu")
  const others = rest.filter((e) => e.source !== "menu")

  const newMenuOps = [1, 2, 3, 4, 5, 6].map((n) => ({
    id: `e_menu_op${n}`,
    source: "menu",
    target: `ramo_op${n}`,
  }))
  const newOps = [
    { id: "e_op1", source: "ramo_op1", target: "resp_como_funciona" },
    { id: "e_op2", source: "ramo_op2", target: "resp_investimento" },
    { id: "e_op3", source: "ramo_op3", target: "resp_agendar" },
    { id: "e_op4", source: "ramo_op4", target: "acao_pedir_cpf_remarcar" },
    { id: "e_op5", source: "ramo_op5", target: "acao_horario" },
    { id: "e_op6", source: "ramo_op6", target: "resp_atendente" },
  ]
  const newEdges = [...newMenuOps, ...menuRest, ...others, ...newOps]
  log(`edges: ${edges.length} -> ${newEdges.length} (menu op: ${newMenuOps.length}, respostas op: ${newOps.length})`)

  await prisma.messageFlow.update({
    where: { id: flow.id },
    data: { nodes, edges: newEdges },
  })

  console.log(out.join("\n"))
  console.log("\nFluxo BOT atualizado com sucesso.")

  // Conferência rápida do resultado salvo
  const saved = await prisma.messageFlow.findUnique({ where: { id: flow.id } })
  const savedNodes = Array.isArray(saved.nodes) ? saved.nodes : []
  console.log("\nRamos do menu agora:")
  for (const n of savedNodes.filter((x) => x.kind === "RAMO" && typeof x.optionNumber === "number")) {
    console.log(`  ${n.optionNumber}️⃣ ${n.label}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
