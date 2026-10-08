/** Sonda: envia o vídeo boas-vindas via W-API para número fictício —
 *  valida o endpoint send-video e o download da URL pelo serviço. */
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
const VIDEO_URL = "https://painel.medicoemdomicilio.com/boas-vindas.mp4"

async function main() {
  const s = await prisma.clinicSettings.findUnique({
    where: { id: 1 },
    select: { wApiInstance: true, wApiToken: true },
  })

  const resp = await fetch(
    `https://api.w-api.app/v1/message/send-video?instanceId=${s.wApiInstance}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s.wApiToken}`,
      },
      body: JSON.stringify({
        phone: TEST_PHONE,
        video: VIDEO_URL,
        caption: "Teste do vídeo de boas-vindas",
      }),
      signal: AbortSignal.timeout(30000),
    }
  )
  console.log(`send-video → HTTP ${resp.status}`)
  console.log((await resp.text()).slice(0, 300))
  console.log(`resumeAt check: nenhum efeito no bot (número fictício)`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
