/**
 * Sonda endpoints prováveis da W-API para inspecionar a fila/status.
 * Uso: npx tsx scripts/probe-api.ts
 */
import { getIntegrationSettings } from "../lib/integrations"

const PATHS = [
  "/queue/queue",
  "/queue",
  "/message/queue",
  "/message/status",
  "/messages",
  "/chats",
  "/instance/info",
]

async function main() {
  const settings = await getIntegrationSettings()
  for (const path of PATHS) {
    const url = `https://api.w-api.app/v1${path}?instanceId=${encodeURIComponent(settings.wApiInstance)}`
    try {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${settings.wApiToken}` },
      })
      const text = await resp.text()
      console.log(`\nGET ${path} → ${resp.status}`)
      console.log(`  ${text.slice(0, 400)}`)
    } catch (error) {
      console.log(`\nGET ${path} → ERRO ${error}`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
