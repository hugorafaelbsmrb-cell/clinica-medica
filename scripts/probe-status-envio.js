/**
 * Sonda: estado da conexao + teste de envio real na W-API.
 * Confirma se a W-API aceita envio mesmo com a instancia desconectada
 * (falso positivo que deixa o sistema marcando mensagens como ENVIADA).
 */
const fs = require("fs")
const path = require("path")

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8")
const match = env.match(/^DATABASE_URL=["']?([^"'\r\n]+)/m)
if (!match) throw new Error("DATABASE_URL nao encontrada no .env")
let url = match[1].replace(":5432", ":6543")
if (!url.includes("pgbouncer=true")) {
  url += (url.includes("?") ? "&" : "?") + "pgbouncer=true"
}
process.env.DATABASE_URL = url

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const BASE = "https://api.w-api.app/v1"

async function main() {
  const cfg = await prisma.clinicSettings.findUnique({
    where: { id: 1 },
    select: { wApiInstance: true, wApiToken: true, name: true },
  })
  const instanceId = cfg?.wApiInstance ?? ""
  const token = cfg?.wApiToken ?? ""
  console.log(`Instancia: ${instanceId} | token: ${token ? "ok" : "AUSENTE"}`)

  // 1) status-instance
  const statusRes = await fetch(
    `${BASE}/instance/status-instance?instanceId=${encodeURIComponent(instanceId)}`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } }
  )
  console.log(`\n[status-instance] HTTP ${statusRes.status}: ${await statusRes.text()}`)

  // 2) envio real de teste (numero do proprio usuario)
  const phone = "559499345048"
  const started = Date.now()
  const sendRes = await fetch(
    `${BASE}/message/send-text?instanceId=${encodeURIComponent(instanceId)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        phone,
        message: "Teste interno do sistema (monitoramento de conexao). Ignore.",
      }),
    }
  )
  const body = await sendRes.text()
  console.log(
    `\n[send-text] HTTP ${sendRes.status} em ${Date.now() - started}ms: ${body.slice(0, 400)}`
  )
  console.log(
    "\n=> Se HTTP 200 tiver messageId/insertedId com a instancia desconectada, o sistema marca ENVIADA sem entregar (falha sistemica confirmada)."
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
