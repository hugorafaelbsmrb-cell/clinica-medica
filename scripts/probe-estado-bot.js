/**
 * Sonda: estado do bot em produção — pausas (BotPause), sessões e mensagens
 * recentes, incluindo as envolvendo o número do teste do médico (…345048).
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

async function main() {
  const pauses = await prisma.botPause.findMany({
    orderBy: { updatedAt: "desc" },
    take: 15,
  })
  console.log(`\n=== BotPause (${pauses.length}) ===`)
  for (const p of pauses) {
    console.log(
      `- ${p.phone} | ${p.reason} | resumeAt=${p.resumeAt.toISOString()} | updated=${p.updatedAt.toISOString()}`
    )
  }
  if (!pauses.length) console.log("(nenhuma pausa registrada)")

  const sessions = await prisma.botSession.findMany({
    orderBy: { updatedAt: "desc" },
    take: 15,
  })
  console.log(`\n=== BotSession (${sessions.length}) ===`)
  for (const s of sessions) {
    console.log(
      `- ${s.phone} | state=${s.state} | modality=${s.modality ?? "-"} | updated=${s.updatedAt.toISOString()}`
    )
  }

  const since = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const msgs = await prisma.message.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: {
      direction: true,
      content: true,
      status: true,
      needsAttention: true,
      mediaUrl: true,
      sentAt: true,
      createdAt: true,
      patient: { select: { name: true, phone: true } },
      whatsAppContact: { select: { name: true, phone: true } },
    },
  })
  console.log(`\n=== Message (ultimas 3h) (${msgs.length}) ===`)
  for (const m of msgs) {
    const who = m.patient?.phone ?? m.whatsAppContact?.phone ?? "?"
    const name = m.patient?.name ?? m.whatsAppContact?.name ?? ""
    const media = m.mediaUrl ? ` media=${String(m.mediaUrl).slice(0, 50)}` : ""
    console.log(
      `- [${m.createdAt.toISOString()}] ${m.direction} ${who} (${name}) ${m.status}${m.needsAttention ? " ATENCAO" : ""}${media} :: ${String(m.content).replace(/\n/g, " ").slice(0, 90)}`
    )
  }

  const alvo = "345048"
  const alvoMsgs = await prisma.message.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
      OR: [
        { patient: { phone: { contains: alvo } } },
        { whatsAppContact: { phone: { contains: alvo } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      direction: true,
      content: true,
      status: true,
      sentAt: true,
      createdAt: true,
      patient: { select: { name: true, phone: true } },
      whatsAppContact: { select: { name: true, phone: true } },
    },
  })
  console.log(`\n=== Message envolvendo "...${alvo}" (6h) (${alvoMsgs.length}) ===`)
  for (const m of alvoMsgs) {
    const who = m.patient?.phone ?? m.whatsAppContact?.phone ?? "?"
    console.log(
      `- [${m.createdAt.toISOString()}] ${m.direction} ${who} ${m.status} :: ${String(m.content).replace(/\n/g, " ").slice(0, 90)}`
    )
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
