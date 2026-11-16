/**
 * Sonda: estado COMPLETO do atendimento de um número específico
 * (BobPause + BotSession + lead/contato + mensagens). Uso:
 *   node scripts/probe-estado-numero.js 94999345048
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

// Busca pelos últimos 8 dígitos do input: o sistema normaliza os números
// removendo o nono dígito (ex.: 94 99934-5048 → 559499345048).
const alvo = (process.argv[2] ?? "345048").replace(/\D/g, "")
const sufixo = alvo.slice(-8)
console.log(`Procurando por números terminando em "${sufixo}"...`)

async function main() {
  const pauses = await prisma.botPause.findMany({
    where: { phone: { contains: sufixo } },
  })
  console.log(`\n=== BotPause (${pauses.length}) ===`)
  for (const p of pauses) {
    const ativa = p.resumeAt.getTime() > Date.now()
    console.log(
      `- ${p.phone} | reason=${p.reason} | resumeAt=${p.resumeAt.toISOString()} | ${ativa ? "ATIVA" : "vencida"} | updated=${p.updatedAt.toISOString()}`
    )
  }

  const sessions = await prisma.botSession.findMany({
    where: { phone: { contains: sufixo } },
  })
  console.log(`\n=== BotSession (${sessions.length}) ===`)
  for (const s of sessions) {
    console.log(
      `- ${s.phone} | state=${s.state} | modality=${s.modality ?? "-"} | updated=${s.updatedAt.toISOString()}`
    )
  }

  const contacts = await prisma.whatsAppContact.findMany({
    where: { phone: { contains: sufixo } },
  })
  console.log(`\n=== WhatsAppContact (lead) (${contacts.length}) ===`)
  for (const c of contacts) {
    console.log(
      `- id=${c.id} | phone=${c.phone} | name=${c.name ?? "-"} | followUpStage=${c.followUpStage} | converted=${c.converted} | lastMessageAt=${c.lastMessageAt.toISOString()}`
    )
  }

  const patients = await prisma.patient.findMany({
    where: { phone: { contains: sufixo } },
    select: { id: true, name: true, phone: true, createdAt: true },
  })
  console.log(`\n=== Patient (${patients.length}) ===`)
  for (const p of patients) {
    console.log(`- id=${p.id} | ${p.name} | ${p.phone} | criado=${p.createdAt.toISOString()}`)
  }

  const contactIds = contacts.map((c) => c.id)
  const patientIds = patients.map((p) => p.id)
  const msgs = await prisma.message.findMany({
    where: {
      OR: [
        ...(contactIds.length ? [{ whatsAppContactId: { in: contactIds } }] : []),
        ...(patientIds.length ? [{ patientId: { in: patientIds } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 15,
  })
  console.log(`\n=== Message desses contatos (ultimas 15 de ${msgs.length > 0 ? "N" : "0"}) ===`)
  for (const m of msgs) {
    console.log(
      `- [${m.createdAt.toISOString()}] ${m.direction} ${m.status}${m.needsAttention ? " ATENCAO" : ""} | ${String(m.content).replace(/\n/g, " ").slice(0, 80)}`
    )
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
