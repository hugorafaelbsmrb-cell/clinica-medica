/**
 * Teste: envia texto com botão (send-button-actions — recurso do plano
 * PRO). Confirma o plano da instância e se recursos avançados funcionam.
 * Uso: npx tsx scripts/test-button.ts
 */
import { getWhatsAppProvider, normalizePhone } from "../lib/whatsapp/provider"

const PHONE = "94999345048"

async function main() {
  const provider = await getWhatsAppProvider()
  const phone = normalizePhone(PHONE)

  if (provider.sendTextWithButtons) {
    const result = await provider.sendTextWithButtons(phone, "TESTE 10 — texto com botão (plano PRO)", [
      { type: "URL", label: "Abrir link", url: "https://painel.medicoemdomicilio.com" },
    ])
    console.log(result.ok ? "✓ Botão enviado" : `✗ Falha: ${result.error}`)
  } else {
    console.log("Provedor sem sendTextWithButtons")
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
