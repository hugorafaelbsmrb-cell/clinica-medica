/**
 * Verifica a imagem atual do fluxo (PNG) e envia o teste.
 * Uso: npx tsx scripts/check-and-send.ts
 */
import { getWhatsAppProvider, normalizePhone } from "../lib/whatsapp/provider"

const PHONE = "94999345048"
const IMAGE_URL =
  "https://api.circuitokids.com.br/uploads/medicodomicilio/6a964d6d39c4d_teste.png"

async function main() {
  const resp = await fetch(IMAGE_URL)
  const buf = Buffer.from(await resp.arrayBuffer())
  const magic = buf.subarray(0, 12).toString("hex")
  console.log(
    `status=${resp.status} bytes=${buf.length} content-type=${resp.headers.get("content-type")}`
  )
  console.log(`magic=${magic} (PNG esperado: 89504e47...)`)

  const provider = await getWhatsAppProvider()
  const phone = normalizePhone(PHONE)
  if (!provider.sendImage) {
    console.log("Provedor sem sendImage")
    return
  }
  const result = await provider.sendImage(
    phone,
    "TESTE 12 — envio direto do link do armazenamento",
    IMAGE_URL
  )
  console.log(result.ok ? "✓ Enviado (URL direta)" : `✗ Falha: ${result.error}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
