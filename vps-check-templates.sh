#!/bin/bash
cd /opt/clinica-medica || exit 1
docker compose exec -T app node <<'NODE'
const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()
async function main() {
  const rows = await p.$queryRawUnsafe(`SELECT id, name, type, active, body FROM "MessageTemplate" ORDER BY "createdAt" ASC`)
  console.log(JSON.stringify(rows, null, 2))
}
main().finally(() => p.$disconnect())
NODE
