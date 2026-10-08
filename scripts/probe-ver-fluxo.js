/** Sonda: imprime o fluxo BOT em produção (tabela MessageFlow). */
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
  const flows = await prisma.messageFlow.findMany({ orderBy: { createdAt: "asc" } })
  for (const f of flows) {
    console.log(`\n=== FLOW ${f.kind} | id=${f.id} | "${f.name}" | enabled=${f.enabled} | updated=${f.updatedAt.toISOString()} ===`)
    const nodes = Array.isArray(f.nodes) ? f.nodes : []
    const edges = Array.isArray(f.edges) ? f.edges : []
    console.log(`nodes=${nodes.length} edges=${edges.length}`)
    for (const n of nodes) {
      const opt = n.optionNumber != null ? ` opt=${n.optionNumber}` : ""
      const label = n.label ? ` label="${n.label}"` : ""
      const kw = Array.isArray(n.keywords) && n.keywords.length ? ` kw=[${n.keywords.slice(0, 6).join(",")}]` : ""
      const media = n.mediaUrl ? ` media=${n.mediaType}:${String(n.mediaUrl).slice(0, 60)}` : ""
      const content = typeof n.content === "string" ? ` content="${n.content.replace(/\n/g, "\\n").slice(0, 90)}"` : ""
      console.log(`- ${n.id} [${n.kind}]${opt}${label}${kw}${media}${content}`)
    }
    console.log("-- edges:")
    for (const e of edges) {
      console.log(`- ${e.id}: ${e.source} -> ${e.target}`)
    }
  }
  if (!flows.length) console.log("NENHUM FLUXO NO BANCO (usa default em memória)")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
