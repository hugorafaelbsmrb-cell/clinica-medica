/**
 * Inspeciona as últimas mensagens tipo DOCUMENTO (e afins) para diagnosticar
 * a falha de envio da prescrição. Uso: npx tsx scripts/check-doc-fail.ts
 */
import { PrismaClient } from "@prisma/client"

const p = new PrismaClient()

async function main() {
  const patient = await p.patient.findFirst({
    where: { name: { contains: "Sebastiana", mode: "insensitive" } },
    select: { id: true, name: true, phone: true },
  })
  console.log("Paciente:", patient)

  if (patient) {
    const messages = await p.message.findMany({
      where: { patientId: patient.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        type: true,
        direction: true,
        status: true,
        content: true,
        mediaUrl: true,
        mediaType: true,
        error: true,
        scheduledFor: true,
        sentAt: true,
        createdAt: true,
      },
    })
    console.log("\nÚltimas mensagens do paciente:")
    for (const m of messages) {
      console.log(JSON.stringify(m, null, 2).slice(0, 600))
      console.log("---")
    }
  }

  // Mensagens DOCUMENTO com falha recentes (qualquer paciente)
  const failed = await p.message.findMany({
    where: { status: "FALHA" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      patientId: true,
      type: true,
      status: true,
      error: true,
      mediaUrl: true,
      content: true,
      createdAt: true,
    },
  })
  console.log("\nMensagens com FALHA (geral):")
  for (const m of failed) {
    console.log(JSON.stringify(m, null, 2).slice(0, 600))
    console.log("---")
  }
}

main()
  .then(() => p.$disconnect())
  .catch((err) => {
    console.error(err)
    p.$disconnect()
    process.exit(1)
  })
