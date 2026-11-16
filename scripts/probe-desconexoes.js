/**
 * Sonda: linha do tempo de falhas de envio (desconexões da API do WhatsApp).
 * Agrupa por dia as mensagens OUT (enviadas/falhas) e IN, mostra os erros
 * mais comuns e a última atividade de cada lado.
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

/** Data no fuso da clínica (YYYY-MM-DD). */
function dayKey(date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
  }).format(date)
}

async function main() {
  const since = new Date(Date.now() - 30 * 24 * 3600_000)
  const rows = await prisma.message.findMany({
    where: { createdAt: { gte: since } },
    select: {
      createdAt: true,
      direction: true,
      status: true,
      type: true,
      error: true,
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
  })
  console.log(`Total de mensagens (30d): ${rows.length}`)

  const byDay = new Map()
  for (const m of rows) {
    const key = dayKey(m.createdAt)
    const entry =
      byDay.get(key) ?? { out: 0, enviadas: 0, falhas: 0, supr: 0, pendentes: 0, inn: 0 }
    if (m.direction === "IN") {
      entry.inn++
    } else {
      entry.out++
      if (m.status === "ENVIADA" || m.status === "ENTREGUE" || m.status === "LIDA") entry.enviadas++
      else if (m.status === "FALHA") entry.falhas++
      else if (m.status === "SUPRIMIDA") entry.supr++
      else if (m.status === "PENDENTE") entry.pendentes++
    }
    byDay.set(key, entry)
  }

  console.log(`\n=== POR DIA (30d) - IN | OUT | enviadas | FALHAS ===`)
  for (const [day, e] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const flag = e.falhas > 0 ? "  <== falhas" : ""
    console.log(
      `${day}  IN=${String(e.inn).padStart(3)}  OUT=${String(e.out).padStart(3)}  ok=${String(e.enviadas).padStart(3)}  FALHA=${String(e.falhas).padStart(3)}${flag}`
    )
  }

  const falhas = rows.filter((m) => m.status === "FALHA")
  console.log(`\n=== ERROS DE FALHA (${falhas.length}) - agrupados ===`)
  const errCount = new Map()
  for (const f of falhas) {
    const key = `${f.type} | ${(f.error ?? "-").slice(0, 90)}`
    errCount.set(key, (errCount.get(key) ?? 0) + 1)
  }
  for (const [k, v] of [...errCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`- ${v}x ${k}`)
  }

  console.log("\n=== ÚLTIMAS FALHAS (8) ===")
  for (const f of falhas.slice(0, 8)) {
    console.log(
      `- ${new Date(f.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} [${f.type}] ${(f.error ?? "-").slice(0, 120)}`
    )
  }

  const lastIn = await prisma.message.findFirst({
    where: { direction: "IN" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, content: true },
  })
  const lastOut = await prisma.message.findFirst({
    where: { direction: "OUT" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, status: true, type: true },
  })
  const lastContact = await prisma.whatsAppContact.aggregate({
    _max: { lastMessageAt: true },
  })
  console.log("\n=== ÚLTIMA ATIVIDADE ===")
  console.log(
    `- IN: ${lastIn ? new Date(lastIn.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-"}`
  )
  console.log(
    `- OUT: ${lastOut ? `${new Date(lastOut.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} [${lastOut.status} ${lastOut.type}]` : "-"}`
  )
  console.log(
    `- Contato (lastMessageAt máx): ${lastContact._max.lastMessageAt ? new Date(lastContact._max.lastMessageAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-"}`
  )

  const pausas = await prisma.botPause.count({ where: { resumeAt: { gt: new Date() } } })
  const sessoes = await prisma.botSession.count()
  console.log(`\nBotPause ativos: ${pausas} | BotSession: ${sessoes}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
