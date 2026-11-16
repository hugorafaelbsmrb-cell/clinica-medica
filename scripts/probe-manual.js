/** Sonda temporária: histórico de mensagens MANUAL (painel) e o que veio depois. */
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
  const clinic = await prisma.clinicSettings.findUnique({
    where: { id: 1 },
    select: { botEnabled: true, botPauseHours: true },
  })
  console.log("=== CLINIC ===")
  console.log(`botEnabled=${clinic.botEnabled} botPauseHours=${clinic.botPauseHours}`)

  // Tipos de mensagem OUT nos últimos 30 dias
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const byType = await prisma.message.groupBy({
    by: ["type"],
    where: { direction: "OUT", createdAt: { gte: since } },
    _count: true,
  })
  console.log("\n=== OUT últimos 30 dias por tipo ===")
  for (const t of byType) console.log(`${t.type}: ${t._count}`)

  // Últimas 15 mensagens MANUAL
  const manuals = await prisma.message.findMany({
    where: { type: "MANUAL", direction: "OUT" },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: {
      createdAt: true,
      sentAt: true,
      status: true,
      patient: { select: { id: true, name: true, phone: true } },
    },
  })
  console.log("\n=== Últimas 15 mensagens MANUAL ===")
  for (const m of manuals) {
    const d = (m.sentAt ?? m.createdAt).toISOString().replace("T", " ").slice(0, 16)
    console.log(`${d} ${m.status} ${m.patient?.name ?? "?"} (${m.patient?.phone ?? "?"})`)
  }

  // Para as 8 mais recentes com paciente: IN depois + OUT depois (fora MANUAL)
  console.log("\n=== Conversas após MANUAL (top 8) ===")
  for (const m of manuals.slice(0, 8)) {
    const pid = m.patient?.id
    if (!pid) continue
    const from = m.sentAt ?? m.createdAt
    const ins = await prisma.message.findMany({
      where: { patientId: pid, direction: "IN", createdAt: { gt: from } },
      orderBy: { createdAt: "asc" },
      take: 6,
      select: { content: true, createdAt: true },
    })
    const outs = await prisma.message.findMany({
      where: {
        patientId: pid,
        direction: "OUT",
        type: { not: "MANUAL" },
        createdAt: { gt: from },
      },
      orderBy: { createdAt: "asc" },
      take: 6,
      select: { type: true, createdAt: true },
    })
    console.log(
      `\n-- ${m.patient?.name} após ${from.toISOString().slice(0, 16)}: ${ins.length} IN / ${outs.length} OUT(auto)`
    )
    for (const i of ins.slice(0, 4)) {
      const dt = i.createdAt.toISOString().slice(0, 16)
      const gap = ((i.createdAt.getTime() - from.getTime()) / 60000).toFixed(0)
      console.log(`   IN  +${gap}min ${dt}: ${i.content.slice(0, 70).replace(/\n/g, " ")}`)
    }
    for (const o of outs.slice(0, 4)) {
      const dt = o.createdAt.toISOString().slice(0, 16)
      const gap = ((o.createdAt.getTime() - from.getTime()) / 60000).toFixed(0)
      console.log(`   OUT +${gap}min ${dt} [${o.type}]`)
    }
  }

  // Últimas 12 mensagens IN (todas)
  const ins = await prisma.message.findMany({
    where: { direction: "IN" },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      content: true,
      createdAt: true,
      patient: { select: { name: true } },
    },
  })
  console.log("\n=== Últimas 12 IN ===")
  for (const i of ins) {
    const dt = i.createdAt.toISOString().slice(0, 16)
    console.log(`${dt} ${i.patient?.name ?? "?"}: ${i.content.slice(0, 60).replace(/\n/g, " ")}`)
  }

  const pauses = await prisma.botPause.findMany({ orderBy: { resumeAt: "desc" } })
  console.log(`\n=== BotPause atuais: ${pauses.length} ===`)
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
