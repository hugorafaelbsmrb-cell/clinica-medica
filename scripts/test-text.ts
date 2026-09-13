/**
 * Teste: envia só um texto puro para confirmar a entrega básica.
 * Uso: npx tsx scripts/test-text.ts
 */
import { getWhatsAppProvider, normalizePhone } from "../lib/whatsapp/provider"

const PHONE = "94999345048"

async function main() {
  const provider = await getWhatsAppProvider()
  const result = await provider.sendText(
    normalizePhone(PHONE),
    "TESTE 3 — só texto (verificação de entrega)"
  )
  console.log(result.ok ? "✓ Texto enviado" : `✗ Falha: ${result.error}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
