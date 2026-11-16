/**
 * Libera a trava do job send-messages (CronRun) para permitir um teste
 * imediato do worker sem esperar os 2 min de intervalo.
 */
const fs = require("fs")
const path = require("path")

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8")
const match = env.match(/^DATABASE_URL=["']?([^"'\r\n]+)/m)
if (!match) throw new Error("DATABASE_URL nao encontrada no .env")
let url = match[1].replace(":5432", ":6543")
if (!url.includes("pgbouncer=true")) {
  url += (url.includes("?") ? "&" : "?") + "pgbouncer=true"
}
process.env.DATABASE_URL = url

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const past = new Date(Date.now() - 5 * 60 * 1000)
  const result = await prisma.cronRun.updateMany({
    where: { name: "send-messages" },
    data: { finishedAt: past },
  })
  console.log(`[lock] linhas liberadas: ${result.count}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
