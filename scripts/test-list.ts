/**
 * Teste: envia lista de opções (send-list, plano PRO) para o número de teste.
 * Uso: npx tsx scripts/test-list.ts
 */
import { getIntegrationSettings } from "../lib/integrations"
import { normalizePhone } from "../lib/whatsapp/provider"

const PHONE = "94999345048"

async function main() {
  const settings = await getIntegrationSettings()
  const url = `https://api.w-api.app/v1/message/send-list?instanceId=${encodeURIComponent(settings.wApiInstance)}`

  const body = {
    phone: normalizePhone(PHONE),
    title: "TESTE 14 — Lista de opções",
    description: "Escolha uma opção para ver como a lista chega no WhatsApp:",
    buttonText: "Ver opções",
    footerText: "Médico em Domicílio",
    sections: [
      {
        title: "Atendimento",
        rows: [
          { title: "Consulta presencial", description: "Atendimento na clínica", rowId: "presencial" },
          { title: "Consulta domiciliar", description: "Médico vai até você", rowId: "domiciliar" },
          { title: "Teleconsulta", description: "Atendimento por vídeo", rowId: "teleconsulta" },
        ],
      },
    ],
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.wApiToken}`,
    },
    body: JSON.stringify(body),
  })
  const text = await resp.text()
  console.log("status:", resp.status)
  console.log("body:", text.slice(0, 400))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
