/**
 * Sonda: guarda de conexão do WhatsApp.
 *
 * 1) consulta o estado real da instância e grava em ClinicSettings;
 * 2) se estiver desconectada, confirma que o provider BLOQUEIA o envio
 *    (nada é disparado para a W-API) — antes o sistema marcava ENVIADA.
 *
 * Roda local: npx tsx scripts/probe-guard-conexao.ts
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const env = readFileSync(join(here, "..", ".env"), "utf8")
const match = env.match(/^DATABASE_URL=["']?([^"'\r\n]+)/m)
if (!match) throw new Error("DATABASE_URL não encontrada no .env")
let url = match[1].replace(":5432", ":6543")
if (!url.includes("pgbouncer=true")) {
  url += (url.includes("?") ? "&" : "?") + "pgbouncer=true"
}
process.env.DATABASE_URL = url

async function main() {
  const { checkAndRecordWhatsAppConnection } = await import(
    "../lib/whatsapp/connection"
  )
  const { getWhatsAppProvider } = await import("../lib/whatsapp/provider")
  const { prisma } = await import("../lib/prisma")

  const state = await checkAndRecordWhatsAppConnection()
  console.log(
    `[conexão] usingWApi=${state.usingWApi} connected=${state.connected} changed=${state.changed}` +
      (state.error ? ` error=${state.error}` : "")
  )

  const provider = await getWhatsAppProvider()
  console.log(`[provider] ${provider.name}`)

  if (state.connected) {
    console.log(
      "=> Instância conectada: nenhum envio de teste será feito (evita mensagem real)."
    )
  } else {
    // Instância offline: o guard deve barrar antes de chamar a W-API.
    const result = await provider.sendText(
      "559499345048",
      "Teste interno (não deveria sair)."
    )
    console.log(
      `[guard] ok=${result.ok} offline=${result.offline} error=${result.error}`
    )
    console.log(
      result.offline
        ? "=> GUARD OK: envio bloqueado, nada foi para a W-API."
        : "=> FALHA: o guard não bloqueou o envio."
    )
  }

  const settings = await prisma.clinicSettings.findUnique({
    where: { id: 1 },
    select: {
      waConnected: true,
      waConnectedAt: true,
      waDisconnectedAt: true,
      waStatusCheckedAt: true,
    },
  })
  console.log("[ClinicSettings]", settings)

  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
