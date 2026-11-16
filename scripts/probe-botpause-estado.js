/** Sonda temporária: status da instância + lista de instâncias da conta. */
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
  const s = await prisma.clinicSettings.findUnique({
    where: { id: 1 },
    select: { wApiInstance: true, wApiToken: true },
  })
  const inst = s.wApiInstance
  const token = s.wApiToken

  const paths = [
    `/instance/status-instance?instanceId=${inst}`,
    `/instance/fetch-instance?instanceId=${inst}`,
    `/integrator/instances`,
  ]
  for (const p of paths) {
    try {
      const r = await fetch(`https://api.w-api.app/v1${p}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20000),
      })
      const text = await r.text()
      console.log(`\n### ${p.split("?")[0]} → HTTP ${r.status}`)
      console.log(text.slice(0, 900))
    } catch (e) {
      console.log(`\n### ${p.split("?")[0]} → ERRO ${e.message}`)
    }
  }

  // Pausas ativas agora
  const pauses = await prisma.botPause.findMany({ orderBy: { resumeAt: "desc" }, take: 10 })
  console.log(`\n=== BOT PAUSES agora: ${pauses.length} ===`)
  for (const p of pauses) {
    console.log(`${p.phone} ${p.reason} resumeAt=${p.resumeAt.toISOString()}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
