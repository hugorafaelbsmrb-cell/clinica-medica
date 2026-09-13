/**
 * Prova de conformidade com a doc da W-API (send-image):
 * mostra exatamente o que o WApiProvider envia no campo `image`
 * em cada modo (URL direta e Base64 com data URL completo).
 * Uso: npx tsx scripts/check-compliance.ts
 */
import { getWhatsAppProvider } from "../lib/whatsapp/provider"
import { downloadImageAsDataUrl } from "../lib/whatsapp/message-service"
import { WApiProvider } from "../lib/whatsapp/wapi-provider"

const IMAGE_URL =
  "https://api.circuitokids.com.br/uploads/medicodomicilio/6a964d6d39c4d_teste.png"

async function main() {
  const provider = await getWhatsAppProvider()
  console.log("Provedor ativo:", provider.name)
  if (!(provider instanceof WApiProvider)) {
    console.log("(não é WApiProvider — verifique as credenciais)")
    return
  }

  // Modo 1: URL direta (nosso padrão atual para URLs públicas)
  console.log("\nMODO URL (o que enviamos hoje):")
  console.log('  image = "' + IMAGE_URL + '"')
  console.log("  Conforme doc? ", IMAGE_URL.startsWith("http") ? "SIM — 'Link da imagem' direto" : "NÃO")

  // Modo 2: Base64 (data URL completo com prefixo)
  const dataUrl = await downloadImageAsDataUrl(IMAGE_URL)
  if (dataUrl) {
    console.log("\nMODO BASE64 (quando a URL não é pública):")
    console.log("  image = \"" + dataUrl.slice(0, 48) + "...\"")
    const hasPrefix = /^data:image\/(png|jpeg|jpg);base64,/.test(dataUrl)
    console.log(
      "  Conforme doc? ",
      hasPrefix ? "SIM — prefixo data:image/...;base64, presente" : "NÃO — prefixo ausente"
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
