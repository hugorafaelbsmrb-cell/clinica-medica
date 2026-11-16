/** Sonda temporária: logs de webhook da W-API + checagem rápida. */
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
  const r = await fetch(
    `https://api.w-api.app/v1/webhook/fetch-webhook-logs?instanceId=${s.wApiInstance}`,
    {
      headers: { Authorization: `Bearer ${s.wApiToken}` },
      signal: AbortSignal.timeout(30000),
    }
  )
  console.log("HTTP", r.status)
  console.log((await r.text()).slice(0, 2500))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
