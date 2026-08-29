"use server"

/**
 * Ações de certificado digital A1 (ICP-Brasil) do médico logado.
 * Upload valida a senha com o signer, criptografa .pfx e senha com
 * AES-256-GCM e desativa o certificado anterior.
 */
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { encryptSecret } from "@/lib/signing/crypto"
import { inspectPfx } from "@/lib/signing/signer-client"

export type CertActionState = {
  success: boolean
  message: string
  subject?: string
  validTo?: string
}

const MAX_PFX_BYTES = 2 * 1024 * 1024 // 2 MB

export async function uploadMyCertificate(
  _prev: CertActionState | null,
  formData: FormData
): Promise<CertActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }

  const file = formData.get("pfx") as File | null
  const password = formData.get("password")?.toString() ?? ""

  if (!file || file.size === 0) {
    return { success: false, message: "Selecione o arquivo .pfx/.p12 do certificado" }
  }
  if (file.size > MAX_PFX_BYTES) {
    return { success: false, message: "Arquivo .pfx muito grande (máx. 2 MB)" }
  }
  if (!password) {
    return { success: false, message: "Informe a senha do certificado" }
  }

  const pfx = Buffer.from(await file.arrayBuffer())

  // Valida a senha e extrai os dados exibidos (sujeito/validade)
  let info
  try {
    info = await inspectPfx(pfx, password)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao ler o certificado"
    return { success: false, message }
  }

  const validFrom = new Date(info.validFrom)
  const validTo = new Date(info.validTo)
  if (validTo <= new Date()) {
    return { success: false, message: "Certificado fora da validade" }
  }

  // Só aceita certificado cuja cadeia valida contra as ACs Raiz ICP-Brasil.
  if (info.icpBrasil !== true) {
    return {
      success: false,
      message:
        info.chainMessage && info.chainMessage.trim()
          ? `Certificado recusado: ${info.chainMessage}. Use um e-CPF A1 emitido por uma autoridade credenciada ICP-Brasil.`
          : "Certificado recusado: não foi possível validar a cadeia ICP-Brasil. Use um e-CPF A1 emitido por uma autoridade credenciada.",
    }
  }

  // Um certificado ativo por usuário: desativa o anterior e grava o novo
  await prisma.$transaction([
    prisma.medicalCertificate.updateMany({
      where: { userId: session.user.id, status: "ACTIVE" },
      data: { status: "REVOKED" },
    }),
    prisma.medicalCertificate.create({
      data: {
        userId: session.user.id,
        encryptedPfx: encryptSecret(pfx),
        encryptedPassword: encryptSecret(password),
        subject: info.subject,
        issuer: info.issuer,
        serialNumber: info.serialNumber ?? null,
        validFrom,
        validTo,
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CREATE",
        entity: "MedicalCertificate",
        details: { subject: info.subject, serialNumber: info.serialNumber },
      },
    }),
  ])

  revalidatePath("/minha-assinatura")
  return {
    success: true,
    message: "Certificado digital ativado",
    subject: info.subject,
    validTo: validTo.toISOString(),
  }
}

/** Remove (desativa) o certificado ativo do médico logado. */
export async function removeMyCertificate(): Promise<CertActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }

  const removed = await prisma.medicalCertificate.updateMany({
    where: { userId: session.user.id, status: "ACTIVE" },
    data: { status: "REVOKED" },
  })

  if (removed.count > 0) {
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DELETE",
        entity: "MedicalCertificate",
      },
    })
  }

  revalidatePath("/minha-assinatura")
  return {
    success: true,
    message: removed.count > 0 ? "Certificado removido" : "Nenhum certificado ativo",
  }
}
