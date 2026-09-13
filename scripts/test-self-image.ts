/**
 * Teste: envia a imagem para o PRÓPRIO número da clínica (auto-mensagem)
 * para isolar se a falha de mídia é global ou específica do chat de teste.
 * Uso: npx tsx scripts/test-self-image.ts
 */
import { getClinicSettings } from "../lib/clinic"
import { getWhatsAppProvider, normalizePhone } from "../lib/whatsapp/provider"

const IMAGE_URL =
  "https://api.circuitokids.com.br/uploads/medicodomicilio/6a963f9d79826_unnamed.jpg"

async function main() {
  const clinic = await getClinicSettings()
  if (!clinic.phone) {
    console.log("Clínica sem telefone cadastrado")
    return
  }
  const phone = normalizePhone(clinic.phone)
  console.log(`Enviando imagem para o próprio número da clínica: ${phone}`)

  const provider = await getWhatsAppProvider()
  if (!provider.sendImage) {
    console.log("Provedor sem sendImage")
    return
  }
  const result = await provider.sendImage(
    phone,
    "TESTE 8 — auto-mensagem com imagem",
    IMAGE_URL
  )
  console.log(result.ok ? "✓ Enviado" : `✗ Falha: ${result.error}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
