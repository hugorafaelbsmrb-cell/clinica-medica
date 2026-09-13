/**
 * Envio de teste: mensagem "Reserva liberada (sem pagamento)" (fluxo
 * AUTOMACAO) para o número de teste, com a imagem do nó MENSAGEM.
 * Uso: npx tsx scripts/send-test-message.ts
 */
import { PrismaClient } from "@prisma/client"
import { getClinicSettings } from "../lib/clinic"
import { parseFlowNodes } from "../lib/whatsapp/flow-types"
import {
  downloadImageAsDataUrl,
  renderTemplate,
  sendTextSmart,
} from "../lib/whatsapp/message-service"
import { getWhatsAppProvider, normalizePhone } from "../lib/whatsapp/provider"

const PHONE = "94999345048"
const FLOW_ID = "cmti1uphc000cvfrszlq8av50" // "Reserva liberada (sem pagamento)"

const BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://painel.medicoemdomicilio.com"

const p = new PrismaClient()

async function main() {
  const flow = await p.messageFlow.findUnique({ where: { id: FLOW_ID } })
  if (!flow) throw new Error(`Fluxo ${FLOW_ID} não encontrado`)

  const nodes = parseFlowNodes(flow.nodes)
  const msg = nodes.find((n) => n.kind === "MENSAGEM")
  if (!msg || msg.kind !== "MENSAGEM") throw new Error("Nó MENSAGEM não encontrado")

  const clinic = await getClinicSettings()
  const patient = await p.patient.findFirst({
    where: { phone: { contains: "94999345048" } },
    select: { id: true, name: true },
  })

  const now = new Date()
  const content = renderTemplate(msg.content, {
    nome: patient?.name?.split(" ")[0] || "Teste",
    data: now.toLocaleDateString("pt-BR"),
    hora: "10:00",
    link: `${BASE_URL}/cadastro`,
    clinica: clinic.name,
  })

  console.log(`Enviando para ${PHONE}:`)
  console.log(content)
  if (msg.mediaUrl) console.log(`Mídia: ${msg.mediaType} ${msg.mediaUrl}`)

  const provider = await getWhatsAppProvider()
  const phone = normalizePhone(PHONE)

  let sent: { ok: boolean; error?: string } | undefined
  if (msg.mediaUrl && msg.mediaType === "IMAGEM" && provider.sendImage) {
    // URL pública: enviamos o link direto (mais confiável na W-API).
    const image = msg.mediaUrl.startsWith("http") ? msg.mediaUrl : await downloadImageAsDataUrl(msg.mediaUrl)
    if (image) {
      sent = await provider.sendImage(phone, content, image)
      if (!sent.ok) {
        console.error(`⚠ sendImage falhou (${sent.error}) — caindo para texto puro`)
      }
    } else {
      console.log("⚠ Falha ao baixar a imagem — caindo para texto puro")
    }
  }
  if (!sent?.ok) {
    sent = await sendTextSmart(provider, phone, content)
  }

  if (sent.ok) {
    console.log("✓ Mensagem enviada")
  } else {
    console.error(`✗ Falha no envio: ${sent.error}`)
    process.exitCode = 1
  }
}

main()
  .then(() => p.$disconnect())
  .catch((err) => {
    console.error(err)
    p.$disconnect()
    process.exit(1)
  })
