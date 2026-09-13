/**
 * Teste: resolve o @lid do número de teste via phone-exists e envia a
 * imagem direto para o LID (identificador preferido pela doc da W-API).
 * Uso: npx tsx scripts/test-lid.ts
 */
import { getIntegrationSettings } from "../lib/integrations"

const PHONE = "94999345048"
const IMAGE_URL =
  "https://api.circuitokids.com.br/uploads/medicodomicilio/6a963f9d79826_unnamed.jpg"

const API_BASE = "https://api.w-api.app/v1"

async function main() {
  const settings = await getIntegrationSettings()
  const query = `instanceId=${encodeURIComponent(settings.wApiInstance)}`

  // 1) Resolve o LID do número
  const existsResp = await fetch(
    `${API_BASE}/contacts/phone-exists?${query}&phoneNumber=${encodeURIComponent(`55${PHONE}`)}`,
    { headers: { Authorization: `Bearer ${settings.wApiToken}` } }
  )
  const existsText = await existsResp.text()
  console.log("phone-exists status:", existsResp.status)
  console.log("phone-exists body:", existsText.slice(0, 300))
  const exists = JSON.parse(existsText) as {
    exists?: boolean
    phoneNumber?: string
    lid?: string
  }
  console.log("exists:", exists.exists, "lid:", exists.lid)

  // 2) Envia a imagem para o @lid (se houver)
  if (exists.lid) {
    const sendResp = await fetch(
      `${API_BASE}/message/send-image?${query}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.wApiToken}`,
        },
        body: JSON.stringify({
          phone: exists.lid,
          image: IMAGE_URL,
          caption: "TESTE 9 — imagem via @lid",
        }),
      }
    )
    const sendText = await sendResp.text()
    console.log("\nsend-image (lid) status:", sendResp.status)
    console.log("send-image (lid) body:", sendText.slice(0, 300))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
