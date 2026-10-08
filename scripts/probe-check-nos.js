/** Confere os nós-chave do fluxo BOT em produção. */
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

async function main() {
  const flow = await prisma.messageFlow.findFirst({ where: { kind: "BOT" } })
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : []
  for (const id of ["menu", "resp_como_funciona", "resp_investimento", "ramo_op1", "ramo_op2", "ramo_op6"]) {
    const n = nodes.find((x) => x.id === id)
    if (!n) {
      console.log(`${id}: NÃO ENCONTRADO`)
      continue
    }
    console.log(
      `${id}: kind=${n.kind} showOptions=${n.showOptions ?? false} media=${n.mediaType ?? "-"}:${n.mediaUrl ?? "-"} opt=${n.optionNumber ?? "-"} label="${n.label ?? "-"}"`
    )
  }

  const edges = Array.isArray(flow.edges) ? flow.edges : []
  console.log("\nEdges das opções:")
  for (const e of edges.filter((x) => /^e_op[1-6]$/.test(x.id) || /^e_menu_op[1-6]$/.test(x.id))) {
    console.log(`  ${e.id}: ${e.source} -> ${e.target}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
