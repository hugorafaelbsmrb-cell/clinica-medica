/**
 * One-off idempotente: adiciona as novas palavras-chave de localização ao
 * ramo "Endereço" do fluxo BOT salvo no banco (o texto da resposta em si
 * vem do código — ação ENDERECO do motor — e já chega com o deploy).
 *
 * Rodar na VPS após o deploy:
 *
 *   docker compose run --rm --no-deps \
 *     -v /opt/clinica-medica/scripts/migrate-bot-endereco.js:/tmp/migrate.js:ro \
 *     -T app sh -c 'cd /app && NODE_PATH=/app/node_modules node /tmp/migrate.js'
 */
const { PrismaClient } = require("@prisma/client")

const NEW_KEYWORDS = [
  "onde voces ficam",
  "onde atende",
  "atende em casa",
  "vai ate mim",
  "clinica fica",
  "voces vem aqui",
]

async function main() {
  const prisma = new PrismaClient()
  try {
    const flow = await prisma.messageFlow.findFirst({ where: { kind: "BOT" } })
    if (!flow) {
      console.log("Fluxo BOT não encontrado no banco — nada a migrar.")
      return
    }

    const nodes = Array.isArray(flow.nodes) ? flow.nodes : []
    const ramo = nodes.find(
      (n) => n && n.kind === "RAMO" && n.id === "ramo_endereco"
    )
    if (!ramo) {
      console.log("Ramo de endereço não encontrado no fluxo — nada a migrar.")
      return
    }

    const keywords = Array.isArray(ramo.keywords) ? ramo.keywords : []
    const missing = NEW_KEYWORDS.filter((k) => !keywords.includes(k))
    if (missing.length === 0) {
      console.log("Keywords de endereço já atualizadas — nada a migrar.")
      return
    }

    const nextNodes = nodes.map((n) =>
      n && n.id === "ramo_endereco"
        ? { ...n, keywords: [...keywords, ...missing] }
        : n
    )

    await prisma.messageFlow.update({
      where: { id: flow.id },
      data: { nodes: nextNodes },
    })

    console.log(
      `✓ Fluxo BOT atualizado: ${missing.length} keywords novas no ramo de endereço (${keywords.length} → ${keywords.length + missing.length}).`
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
