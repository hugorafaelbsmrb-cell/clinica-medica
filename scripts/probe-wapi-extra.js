/** Sonda temporária: fetch-instance COMPLETO + sondagem de endpoints de chat/mensagens. */
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

  console.log("=== fetch-instance COMPLETO ===")
  const r = await fetch(
    `https://api.w-api.app/v1/instance/fetch-instance?instanceId=${inst}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(25000) }
  )
  const full = await r.json()
  console.log(JSON.stringify(full, null, 2).slice(0, 4000))

  console.log("\n=== Sondagem de endpoints de chat/mensagens ===")
  const paths = [
    "/chat/find-chats",
    "/chat/fetch-chats",
    "/chat/find-messages",
    "/message/fetch-messages",
    "/message/find-messages",
  ]
  for (const p of paths) {
    try {
      const resp = await fetch(`https://api.w-api.app/v1${p}?instanceId=${inst}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20000),
      })
      const text = (await resp.text()).slice(0, 250)
      console.log(`${p} → HTTP ${resp.status}: ${text.replace(/\n/g, " ")}`)
    } catch (e) {
      console.log(`${p} → ERRO ${e.message}`)
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
