/** Sonda temporária: envia mensagem via W-API para (a) o próprio número conectado
 *  (self-send) e (b) número fictício, para capturar o ECO no webhook com os
 *  campos fromMe/fromApi/isGroup (wa-diag v2). */
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

const TEST_PHONE = "5511930000000"

async function sendText(instanceId, token, phone, message) {
  const resp = await fetch(
    `https://api.w-api.app/v1/message/send-text?instanceId=${instanceId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ phone, message }),
      signal: AbortSignal.timeout(25000),
    }
  )
  const text = await resp.text()
  console.log(`send-text ${phone} → HTTP ${resp.status} | ${text.slice(0, 220)}`)
}

async function main() {
  const s = await prisma.clinicSettings.findUnique({
    where: { id: 1 },
    select: { wApiInstance: true, wApiToken: true },
  })

  // 1) Descobrir o número conectado (para self-send)
  const info = await fetch(
    `https://api.w-api.app/v1/instance/fetch-instance?instanceId=${s.wApiInstance}`,
    { headers: { Authorization: `Bearer ${s.wApiToken}` }, signal: AbortSignal.timeout(20000) }
  )
  const infoText = await info.text()
  let connectedPhone = null
  try {
    const j = JSON.parse(infoText)
    const inst = j?.instance ?? j?.data ?? j
    connectedPhone = String(inst?.connectedPhone ?? inst?.phone ?? "").replace(/\D/g, "")
  } catch {}
  console.log(`conectado=${connectedPhone || "(não detectado)"} (fetch-instance HTTP ${info.status})`)

  const stamp = new Date().toISOString()

  // 2) Self-send (mensagem para o próprio número) — cenário garantido de eco
  if (connectedPhone) {
    await sendText(s.wApiInstance, s.wApiToken, connectedPhone, `teste eco self ${stamp}`)
  }

  // 3) Repetir envio para número fictício (reproduzir eco do 1º teste)
  await sendText(s.wApiInstance, s.wApiToken, TEST_PHONE, `teste eco ficticio ${stamp}`)

  console.log(`stamp=${stamp}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
