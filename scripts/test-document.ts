/**
 * Workaround: envia a imagem do fluxo como DOCUMENTO (send-document).
 * Uso: npx tsx scripts/test-document.ts
 */
import { getWhatsAppProvider, normalizePhone } from "../lib/whatsapp/provider"

const PHONE = "94999345048"
const IMAGE_URL =
  "https://api.circuitokids.com.br/uploads/medicodomicilio/6a963f9d79826_unnamed.jpg"

async function main() {
  const resp = await fetch(IMAGE_URL)
  const buf = Buffer.from(await resp.arrayBuffer())
  console.log(`bytes=${buf.length}`)

  const provider = await getWhatsAppProvider()
  const result = await provider.sendDocument(
    normalizePhone(PHONE),
    "TESTE 7 — imagem enviada como DOCUMENTO",
    buf,
    "reserva-liberada.jpg"
  )
  console.log(result.ok ? "✓ Documento enviado" : `✗ Falha: ${result.error}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
