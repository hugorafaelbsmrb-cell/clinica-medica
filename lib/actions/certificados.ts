"use server"

/**
 * Ações de certificado digital A1 (ICP-Brasil) do médico logado.
 * Upload valida a senha com o signer, criptografa .pfx e senha com
 * AES-256-GCM e desativa o certificado anterior.
 */
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { encryptSecret, decryptSecret } from "@/lib/signing/crypto"
import { inspectPfx } from "@/lib/signing/signer-client"
import { openBirdIdOtpSession, revokeBirdIdSession } from "@/lib/signing/birdid-client"

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

/** Desconecta o certificado em nuvem Bird ID do médico logado. */
export async function disconnectMyBirdId(): Promise<CertActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }

  const removed = await prisma.birdIdCredential.updateMany({
    where: { userId: session.user.id, status: "ACTIVE" },
    data: { status: "REVOKED" },
  })

  if (removed.count > 0) {
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DELETE",
        entity: "BirdIdCredential",
      },
    })
  }

  revalidatePath("/minha-assinatura")
  return {
    success: true,
    message: removed.count > 0 ? "Bird ID desconectado" : "Nenhuma conexão Bird ID ativa",
  }
}

/**
 * Abre uma sessão de assinatura Bird ID com o OTP do app (6 dígitos).
 * Enquanto a sessão valer, os PDFs saem assinados sem push por documento.
 * Uma sessão ativa por médico: abrir uma nova revoga a anterior.
 */
export async function openBirdIdSession(
  _prev: CertActionState | null,
  formData: FormData
): Promise<CertActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }

  const otp = (formData.get("otp")?.toString() ?? "").replace(/\D/g, "")
  if (!/^\d{6}$/.test(otp)) {
    return { success: false, message: "Informe o código de 6 dígitos exibido no app Bird ID" }
  }

  // O médico precisa ter o Bird ID conectado (CPF é o username no Bird ID).
  const credential = await prisma.birdIdCredential.findFirst({
    where: { userId: session.user.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  })
  if (!credential) {
    return { success: false, message: "Conecte o Bird ID antes de abrir uma sessão de assinatura" }
  }

  let token
  try {
    token = await openBirdIdOtpSession({ cpf: credential.cpf, otp })
  } catch (error) {
    // Pequeno atraso para dificultar força bruta no OTP (6 dígitos).
    await new Promise((resolve) => setTimeout(resolve, 500))
    const message = error instanceof Error ? error.message : "Não foi possível abrir a sessão"
    return { success: false, message }
  }

  await prisma.$transaction([
    prisma.birdIdSession.updateMany({
      where: { userId: session.user.id, status: "ACTIVE" },
      data: { status: "REVOKED" },
    }),
    prisma.birdIdSession.create({
      data: {
        userId: session.user.id,
        encryptedToken: encryptSecret(token.accessToken),
        scope: token.scope,
        expiresAt: new Date(Date.now() + token.expiresIn * 1000),
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CREATE",
        entity: "BirdIdSession",
        details: { scope: token.scope },
      },
    }),
  ])

  revalidatePath("/minha-assinatura")
  return {
    success: true,
    message: "Sessão de assinatura aberta — os PDFs saem assinados sem push",
  }
}

/** Encerra a sessão de assinatura Bird ID ativa do médico logado. */
export async function closeBirdIdSession(): Promise<CertActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }

  const active = await prisma.birdIdSession.findFirst({
    where: { userId: session.user.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  })

  const closed = await prisma.birdIdSession.updateMany({
    where: { userId: session.user.id, status: "ACTIVE" },
    data: { status: "REVOKED" },
  })

  // Revoga o token no Bird ID (best-effort; o banco já encerrou a sessão).
  if (active) {
    try {
      const accessToken = decryptSecret(active.encryptedToken).toString("utf8")
      await revokeBirdIdSession(accessToken)
    } catch (error) {
      console.warn("[BirdID] Não foi possível revogar o token no Bird ID:", error)
    }
  }

  if (closed.count > 0) {
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DELETE",
        entity: "BirdIdSession",
      },
    })
  }

  revalidatePath("/minha-assinatura")
  return {
    success: true,
    message: closed.count > 0 ? "Sessão de assinatura encerrada" : "Nenhuma sessão ativa",
  }
}
