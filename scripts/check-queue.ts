/**
 * Consulta a fila de mensagens da instância na W-API (endpoint /quere/quere).
 * Uso: npx tsx scripts/check-queue.ts
 */
import { getIntegrationSettings } from "../lib/integrations"

async function main() {
  const settings = await getIntegrationSettings()
  const url = `https://api.w-api.app/v1/quere/quere?instanceId=${encodeURIComponent(settings.wApiInstance)}&perPage=50&page=1`
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${settings.wApiToken}` },
  })
  const text = await resp.text()
  console.log("status:", resp.status)
  console.log("body:", text.slice(0, 3000))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
