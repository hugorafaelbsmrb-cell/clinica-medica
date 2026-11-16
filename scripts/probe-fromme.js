/**
 * Sonda temporária: simula o webhook fromMe=true (equipe respondendo pelo
 * celular) e verifica se o BotPause é criado. Limpa o registro no final.
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

const TEST_PHONE = "5511930000000"

async function main() {
  // Limpa eventual resíduo de teste anterior
  await prisma.botPause.deleteMany({ where: { phone: TEST_PHONE } })

  const payload = {
    event: "webhookReceived",
    fromMe: true,
    chat: { id: `${TEST_PHONE}@c.us` },
    sender: { id: `${TEST_PHONE}@c.us` },
    msgContent: { conversation: "teste interno de eco fromMe - ignorar" },
    moment: Math.floor(Date.now() / 1000),
  }

  const r = await fetch("https://painel.medicoemdomicilio.com/api/webhooks/whatsapp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  })
  console.log("POST webhook simulado → HTTP", r.status, await r.text())

  // Aguarda o processamento e confere se a pausa foi criada
  await new Promise((res) => setTimeout(res, 3000))
  const pause = await prisma.botPause.findUnique({ where: { phone: TEST_PHONE } })
  if (pause) {
    console.log("PAUSA CRIADA:", pause.phone, pause.reason, "resumeAt=", pause.resumeAt.toISOString())
  } else {
    console.log("NENHUMA pausa criada — o fluxo fromMe não está funcionando no servidor")
  }

  // Limpeza do teste
  await prisma.botPause.deleteMany({ where: { phone: TEST_PHONE } })
  console.log("limpeza ok")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
