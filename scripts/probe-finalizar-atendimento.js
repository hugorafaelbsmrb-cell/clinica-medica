/**
 * Finaliza o atendimento de um número: remove a pausa do bot (BotPause) e
 * a sessão de conversa (BotSession), para o bot iniciar o fluxo do zero.
 * NÃO apaga histórico de mensagens/lead/marketing.
 * Uso: node scripts/probe-finalizar-atendimento.js 94999345048
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

// Últimos 8 dígitos: o sistema normaliza removendo o nono dígito.
const alvo = (process.argv[2] ?? "").replace(/\D/g, "")
if (alvo.length < 8) throw new Error("Passe o número com DDD, ex.: 94999345048")
const sufixo = alvo.slice(-8)
console.log(`Número alvo (sufixo "${sufixo}"):`)

async function main() {
  const pauses = await prisma.botPause.findMany({
    where: { phone: { contains: sufixo } },
  })
  console.log(`\n[1] BotPause encontradas (${pauses.length}):`)
  for (const p of pauses) {
    console.log(
      `    - ${p.phone} | reason=${p.reason} | resumeAt=${p.resumeAt.toISOString()}`
    )
  }
  if (pauses.length) {
    const del = await prisma.botPause.deleteMany({
      where: { phone: { in: pauses.map((p) => p.phone) } },
    })
    console.log(`    -> removidas: ${del.count}`)
  }

  const sessions = await prisma.botSession.findMany({
    where: { phone: { contains: sufixo } },
  })
  console.log(`\n[2] BotSession encontradas (${sessions.length}):`)
  for (const s of sessions) {
    console.log(`    - ${s.phone} | state=${s.state}`)
  }
  if (sessions.length) {
    const del = await prisma.botSession.deleteMany({
      where: { phone: { in: sessions.map((s) => s.phone) } },
    })
    console.log(`    -> removidas: ${del.count}`)
  }

  console.log("\n[3] Histórico de mensagens/lead preservado (nada apagado).")
  console.log("Atendimento finalizado — bot atende do zero na próxima mensagem.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
