/**
 * Diagnóstico do send-image: inspeciona o formato real do arquivo e envia
 * 3 imagens de fontes diferentes para isolar o problema.
 * Uso: npx tsx scripts/test-images.ts
 */
import { getWhatsAppProvider, normalizePhone } from "../lib/whatsapp/provider"

const PHONE = "94999345048"

const IMAGES: Array<{ caption: string; url: string }> = [
  {
    caption: "TESTE 4 — logo W-API (png da doc oficial)",
    url: "https://b350d4e2eda752c0bbc71eaad9a4fb09.cdn.bubble.io/f17310099915978x40012094395188000/LOGO%20W-API.png",
  },
  {
    caption: "TESTE 5 — placeholder png",
    url: "https://placehold.co/300x200.png",
  },
  {
    caption: "TESTE 6 — imagem do fluxo (circuitokids)",
    url: "https://api.circuitokids.com.br/uploads/medicodomicilio/6a963f9d79826_unnamed.jpg",
  },
]

async function main() {
  // 1) Inspeciona o formato REAL (magic bytes) de cada imagem
  for (const item of IMAGES) {
    try {
      const resp = await fetch(item.url)
      const buf = Buffer.from(await resp.arrayBuffer())
      const magic = buf.subarray(0, 12).toString("hex")
      console.log(`\n${item.caption}`)
      console.log(`  status=${resp.status} bytes=${buf.length} content-type=${resp.headers.get("content-type")}`)
      console.log(`  magic=${magic}`)
    } catch (error) {
      console.log(`\n${item.caption}\n  ERRO ao baixar: ${error}`)
    }
  }

  // 2) Envia cada uma por URL direta
  const provider = await getWhatsAppProvider()
  const phone = normalizePhone(PHONE)
  for (const item of IMAGES) {
    if (!provider.sendImage) {
      console.log("Provedor sem sendImage")
      return
    }
    const result = await provider.sendImage(phone, item.caption, item.url)
    console.log(`\nEnviado "${item.caption}": ${result.ok ? "ok" : `FALHA ${result.error}`}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
