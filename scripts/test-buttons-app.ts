/**
 * Teste: envia mensagem com botões de ação (send-buttons-action) usando o
 * caminho real do app (sendTextSmart), como o bot envia links de pagamento.
 * Uso: npx tsx scripts/test-buttons-app.ts
 */
import { getWhatsAppProvider, normalizePhone } from "../lib/whatsapp/provider"
import { sendTextSmart } from "../lib/whatsapp/message-service"

const PHONE = "94999345048"

async function main() {
  const provider = await getWhatsAppProvider()
  const phone = normalizePhone(PHONE)

  const content =
    "TESTE 13 — exemplo real de texto com botões de ação:\nOlá Teste! 😊 Seu horário está reservado. Para confirmar a consulta, faça o pagamento de R$ 150,00 ou agende pelo link abaixo:"

  const result = await sendTextSmart(provider, phone, content, [
    { type: "URL", label: "Pagar agora", url: "https://painel.medicoemdomicilio.com" },
    { type: "URL", label: "Agendar consulta", url: "https://painel.medicoemdomicilio.com/cadastro" },
  ])

  console.log(result.ok ? "✓ Mensagem com botões enviada" : `✗ Falha: ${result.error}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
