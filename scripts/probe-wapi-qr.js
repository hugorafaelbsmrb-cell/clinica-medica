/** Sonda temporária: obtém QR code da instância W-API (e salva PNG se vier). */
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

  const r = await fetch(`https://api.w-api.app/v1/instance/qr-code?instanceId=${inst}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60000),
  })
  const text = await r.text()
  console.log("HTTP", r.status)
  try {
    const json = JSON.parse(text)
    if (json.qrcode?.startsWith("data:image")) {
      const b64 = json.qrcode.split(",")[1]
      const out = path.join(__dirname, "..", "qrcode-instancia.png")
      fs.writeFileSync(out, Buffer.from(b64, "base64"))
      console.log("QR salvo em:", out)
    } else {
      console.log(text.slice(0, 500))
    }
  } catch {
    console.log(text.slice(0, 500))
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
