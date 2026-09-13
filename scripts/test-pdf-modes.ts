/**
 * Testa os modos alternativos do send-document para contornar o 500:
 * A) Base64 com prefixo data:application/pdf;base64,
 * B) URL do storage (uploadMedia) — modo "Link do documento" da doc.
 * Uso: $env:DATABASE_URL='...6543...'; npx tsx scripts/test-pdf-modes.ts
 */
import { generatePrescriptionPdf } from "../lib/pdf/prescription-pdf"
import { uploadMedia } from "../lib/media/storage"
import { getIntegrationSettings } from "../lib/integrations"
import { normalizePhone } from "../lib/whatsapp/provider"

const TEST_PHONE = "94999345048"

const clinic = {
  name: "Médico em Domicílio",
  address: "Rua de Teste, 123",
  phone: "94 98405-3443",
  email: null,
  cnpj: null,
  horarioAtendimento: null,
  logoDataUrl: null,
}

async function postSendDocument(body: Record<string, unknown>) {
  const settings = await getIntegrationSettings()
  const url = `https://api.w-api.app/v1/message/send-document?instanceId=${encodeURIComponent(settings.wApiInstance)}`
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.wApiToken}`,
    },
    body: JSON.stringify(body),
  })
  const text = await resp.text()
  console.log(`status=${resp.status} body=${text.slice(0, 200)}`)
  return resp.status === 200
}

async function main() {
  const pdf = await generatePrescriptionPdf({
    patientName: "Teste PDF",
    patientBirthDate: null,
    patientPhone: null,
    patientCpf: null,
    doctorName: "Dr. Teste",
    doctorCrm: "CRM 000",
    doctorSignature: null,
    signatureImage: null,
    clinic,
    issuedAt: new Date(),
    items: [
      { medication: "Dipirona 1g", dosage: "1 comprimido", frequency: "8/8h", duration: "5 dias", instructions: "Via oral" },
    ],
  })

  const phone = normalizePhone(TEST_PHONE)
  const b64 = pdf.toString("base64")

  console.log("=== A) Base64 com prefixo data:application/pdf ===")
  await postSendDocument({
    phone,
    document: `data:application/pdf;base64,${b64}`,
    extension: "pdf",
    fileName: "prescricao-modo-a.pdf",
    caption: "TESTE 17 — PDF modo A (base64 com prefixo data:)",
  })

  console.log("\n=== B) URL do storage (uploadMedia) ===")
  const { url } = await uploadMedia(pdf, "prescricao-modo-b.pdf", "application/pdf")
  console.log("URL:", url)
  await postSendDocument({
    phone,
    document: url,
    extension: "pdf",
    fileName: "prescricao-modo-b.pdf",
    caption: "TESTE 18 — PDF modo B (link do documento)",
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
