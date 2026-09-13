/**
 * Verifica se a assinatura digital está habilitada e se o médico da última
 * prescrição da Sebastiana tem certificado ativo (para saber se o reenvio
 * dispararia um push no app Bird ID). Uso: npx tsx scripts/check-signing.ts
 */
import { PrismaClient } from "@prisma/client"

const p = new PrismaClient()

async function main() {
  const c = await p.clinicSettings.findUnique({
    where: { id: 1 },
    select: { enableDigitalSignature: true },
  })
  console.log("enableDigitalSignature =", c?.enableDigitalSignature)

  const rx = await p.prescription.findFirst({
    where: { patientId: "cmtk9ifyu0028pa0j73ysw98m" },
    orderBy: { createdAt: "desc" },
    select: { id: true, doctorId: true, createdAt: true },
  })
  console.log("prescrição:", rx)

  if (rx) {
    const bird = await p.birdIdCredential.findFirst({
      where: { userId: rx.doctorId ?? "", status: "ACTIVE" },
    })
    const cert = await p.medicalCertificate.findFirst({
      where: { userId: rx.doctorId ?? "", status: "ACTIVE" },
    })
    console.log("birdId ativo:", !!bird, "| A1 ativo:", !!cert)
  }
}

main()
  .then(() => p.$disconnect())
  .catch((err) => {
    console.error(err)
    p.$disconnect()
    process.exit(1)
  })
