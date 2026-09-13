/**
 * Reproduz o envio da prescrição da Sebastiana para diagnosticar o 500.
 * 1) Gera o PDF real; 2) mostra tamanho/magic; 3) envia via send-document.
 * Uso: npx tsx scripts/repro-prescricao.ts
 */
import { PrismaClient } from "@prisma/client"
import { generatePrescriptionPdf } from "../lib/pdf/prescription-pdf"
import { getClinicSettings } from "../lib/clinic"
import { getWhatsAppProvider, normalizePhone } from "../lib/whatsapp/provider"

const TEST_PHONE = "94999345048"
const p = new PrismaClient()

async function main() {
  const prescription = await p.prescription.findFirst({
    where: {
      patientId: "cmtk9ifyu0028pa0j73ysw98m",
    },
    orderBy: { createdAt: "desc" },
    include: { patient: true, doctor: true, items: true },
  })
  if (!prescription) throw new Error("Prescrição não encontrada")

  const clinic = await getClinicSettings()
  const generated = await generatePrescriptionPdf({
    patientName: prescription.patient.name,
    patientBirthDate: prescription.patient.birthDate,
    patientPhone: prescription.patient.phone,
    patientCpf: prescription.patient.cpf,
    doctorName: prescription.doctor?.name,
    doctorCrm: prescription.doctor?.crm,
    doctorSignature: prescription.doctor?.signatureText,
    signatureImage: prescription.doctor?.signatureImage,
    clinic,
    issuedAt: prescription.createdAt,
    items: prescription.items,
  })

  console.log(`PDF bytes=${generated.length}`)
  console.log(`magic=${generated.subarray(0, 8).toString("hex")} (esperado: 25504446...)`)
  console.log(`base64 length=${generated.toString("base64").length}`)

  const provider = await getWhatsAppProvider()
  const result = await provider.sendDocument(
    normalizePhone(TEST_PHONE),
    "TESTE 15 — prescrição PDF da Sebastiana (reprodução)",
    generated,
    "prescricao-teste.pdf"
  )
  console.log(result.ok ? "✓ Documento enviado" : `✗ Falha: ${result.error}`)

  // Hipótese de tamanho: um PDF mínimo passa?
  const tiny = await generatePrescriptionPdf({
    patientName: "Teste",
    patientBirthDate: null,
    patientPhone: null,
    patientCpf: null,
    doctorName: "Dr. Teste",
    doctorCrm: "CRM 000",
    doctorSignature: null,
    signatureImage: null,
    clinic,
    issuedAt: new Date(),
    items: [{ medication: "Dipirona 1g", dosage: null, frequency: null, duration: null, instructions: null }],
  })
  console.log(`\nPDF mínimo bytes=${tiny.length}`)
  const result2 = await provider.sendDocument(
    normalizePhone(TEST_PHONE),
    "TESTE 16 — PDF mínimo",
    tiny,
    "prescricao-minima.pdf"
  )
  console.log(result2.ok ? "✓ PDF mínimo enviado" : `✗ Falha: ${result2.error}`)
}

main()
  .then(() => p.$disconnect())
  .catch((err) => {
    console.error(err)
    p.$disconnect()
    process.exit(1)
  })
