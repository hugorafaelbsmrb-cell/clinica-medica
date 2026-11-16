/**
 * Sonda de descoberta: procura endpoints de atualização de webhook e de
 * leitura de mensagens na W-API. Todos os POSTs usam body no-op/inofensivo
 * (config atual idêntica ou consulta) — nada é alterado de propósito.
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

const RECEIVED = "https://painel.medicoemdomicilio.com/api/webhooks/whatsapp"

// Body idêntico ao estado atual → se um endpoint de update existir, é no-op.
const NO_OP_BODY = {
  webhookReceivedUrl: RECEIVED,
  webhookStatusUrl: "",
  webhookDeliveryUrl: "",
  webhookPresenceUrl: "",
  webhookConnectedUrl: "",
  webhookDisconnectedUrl: "",
  webhookPaymentUrl: "",
}

async function call(inst, token, method, p, body) {
  try {
    const r = await fetch(`https://api.w-api.app/v1${p}?instanceId=${inst}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    })
    const text = await r.text()
    console.log(
      `${method} ${p} -> HTTP ${r.status} | ${text.replace(/\s+/g, " ").slice(0, 220)}`
    )
  } catch (e) {
    console.log(`${method} ${p} -> ERRO ${e instanceof Error ? e.message : e}`)
  }
}

async function main() {
  const s = await prisma.clinicSettings.findUnique({
    where: { id: 1 },
    select: { wApiInstance: true, wApiToken: true },
  })
  const inst = s.wApiInstance
  const token = s.wApiToken
  console.log(`instância=${inst}\n`)

  console.log("=== candidatos: update de webhook (POST no-op) ===")
  for (const p of [
    "/instance/update-webhook",
    "/webhook/update-webhook",
    "/webhook/set-webhook",
    "/instance/set-webhook",
    "/instance/update-instance",
    "/instance/edit-instance",
    "/webhook/update",
  ]) {
    await call(inst, token, "POST", p, NO_OP_BODY)
  }

  console.log("\n=== candidatos: leitura de mensagens/chats (consulta) ===")
  await call(inst, token, "POST", "/chat/find-messages", {
    phone: "559499345048",
    page: 1,
    pageSize: 5,
  })
  await call(inst, token, "POST", "/chat/find-chats", { page: 1, pageSize: 5 })
  await call(inst, token, "POST", "/message/find-messages", {
    phone: "559499345048",
    page: 1,
    pageSize: 5,
  })
  await call(inst, token, "GET", "/chat/messages?phone=559499345048")
  await call(inst, token, "GET", "/instance/messages?phone=559499345048")
  await call(inst, token, "GET", "/chat/find-chats")
  await call(inst, token, "POST", "/chat/list-messages", {
    phone: "559499345048",
  })
  await call(inst, token, "GET", "/message/list?phone=559499345048")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
