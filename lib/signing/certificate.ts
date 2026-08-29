/**
 * Orquestração da assinatura digital ICP-Brasil no fluxo de PDFs.
 *
 * Regras: a clínica precisa ter enableDigitalSignature ligado e o médico
 * precisa ter um certificado ACTIVE dentro da validade. Qualquer falha
 * (signer fora do ar, senha inválida etc.) devolve o PDF sem assinatura
 * digital — o fluxo do documento nunca é interrompido.
 */
import { prisma } from "@/lib/prisma"
import { decryptSecret } from "./crypto"
import { signPdfWithSigner } from "./signer-client"

/** Certificado digital ativo do médico (fora do prazo = null). */
export async function getActiveCertificate(userId: string | null | undefined) {
  if (!userId) return null
  const now = new Date()
  const cert = await prisma.medicalCertificate.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { uploadedAt: "desc" },
  })
  if (!cert) return null
  if (cert.validTo < now) return null
  return cert
}

/**
 * Assina o PDF do documento quando habilitado e há certificado válido.
 * Retorna { signed: true, pdf } com a assinatura PAdES embutida ou
 * { signed: false, pdf } com o PDF original (fallback sem assinatura).
 */
export async function signPdfIfEnabled(input: {
  doctorId: string | null | undefined
  doctorName?: string | null
  documentType: string
  documentId?: string | null
  patientId?: string | null
  reason?: string
  actorId?: string | null
  pdf: Buffer
}): Promise<{ signed: boolean; pdf: Buffer }> {
  const clinic = await prisma.clinicSettings.findUnique({ where: { id: 1 } })
  if (!clinic?.enableDigitalSignature) return { signed: false, pdf: input.pdf }

  const cert = await getActiveCertificate(input.doctorId)
  if (!cert) return { signed: false, pdf: input.pdf }

  try {
    const pfx = decryptSecret(cert.encryptedPfx)
    const password = decryptSecret(cert.encryptedPassword).toString("utf8")
    const signed = await signPdfWithSigner({
      pdf: input.pdf,
      pfx,
      password,
      doctorName: input.doctorName ?? "Médico",
      reason:
        input.reason ??
        (input.documentType === "Prescription"
          ? "Prescrição médica"
          : "Plano terapêutico"),
      userId: input.doctorId ?? "",
    })
    await prisma.auditLog.create({
      data: {
        userId: input.actorId ?? null,
        action: "SIGN",
        entity: input.documentType,
        entityId: input.documentId ?? null,
        patientId: input.patientId ?? null,
        details: {
          certificateId: cert.id,
          serialNumber: cert.serialNumber,
          level: signed.level,
        },
      },
    })
    return { signed: true, pdf: signed.pdf }
  } catch (error) {
    console.error(
      `[Assinatura] Falha ao assinar ${input.documentType} (fallback sem assinatura):`,
      error
    )
    return { signed: false, pdf: input.pdf }
  }
}
