/**
 * One-off: remove contatos do WhatsApp com telefone fora do formato
 * brasileiro (ex.: IDs de grupos do WhatsApp). Rodar na VPS após o deploy:
 *
 *   docker compose run --rm --no-deps \
 *     -v /opt/clinica-medica/scripts/cleanup-invalid-contacts.js:/tmp/cleanup.js:ro \
 *     -T app sh -c 'cd /app && NODE_PATH=/app/node_modules node /tmp/cleanup.js'
 */
const { PrismaClient } = require("@prisma/client")

const VALID_PHONE = /^55\d{10,11}$/

async function main() {
  const prisma = new PrismaClient()
  try {
    const rows = await prisma.whatsAppContact.findMany({
      select: { phone: true },
    })
    const invalid = rows.filter((r) => !VALID_PHONE.test(r.phone))

    if (invalid.length === 0) {
      console.log("Nenhum contato inválido para remover.")
      return
    }

    console.log("Contatos inválidos encontrados:")
    for (const row of invalid) console.log(`  - ${row.phone}`)

    const { count } = await prisma.whatsAppContact.deleteMany({
      where: { phone: { in: invalid.map((r) => r.phone) } },
    })
    console.log(`Contatos inválidos removidos: ${count}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
