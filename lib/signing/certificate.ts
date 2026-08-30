/**
 * Orquestração da assinatura digital ICP-Brasil no fluxo de PDFs.
 *
 * Regras: a clínica precisa ter enableDigitalSignature ligado e o médico
 * precisa ter um certificado ativo dentro da validade — certificado em
 * nuvem Bird ID (assinatura por push, tem precedência) ou A1 (.pfx local).
 * Qualquer falha (signer fora do ar, push não aprovado, senha inválida
 * etc.) devolve o PDF sem assinatura digital — o fluxo do documento
 * nunca é interrompido.
 */
import { prisma } from "@/lib/prisma"
import { decryptSecret } from "./crypto"
import { getBirdIdConfig } from "./birdid-client"
import {
  BirdIdSessionExpiredError,
  signPdfCloudWithSigner,
  signPdfSessionWithSigner,
  signPdfWithSigner,
} from "./signer-client"

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

/** Conexão Bird ID ativa do médico (fora do prazo = null). */
export async function getActiveBirdIdCredential(
  userId: string | null | undefined
) {
  if (!userId) return null
  const now = new Date()
  const credential = await prisma.birdIdCredential.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  })
  if (!credential) return null
  if (credential.validTo < now) return null
  return credential
}

/** Sessão de assinatura Bird ID ativa do médico (fora do prazo = null). */
export async function getActiveBirdIdSession(userId: string | null | undefined) {
  if (!userId) return null
  const now = new Date()
  const session = await prisma.birdIdSession.findFirst({
    where: { userId, status: "ACTIVE", expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  })
  if (!session) return null
  return session
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
  patientName?: string | null
  reason?: string
  actorId?: string | null
  pdf: Buffer
}): Promise<{ signed: boolean; pdf: Buffer }> {
  const clinic = await prisma.clinicSettings.findUnique({ where: { id: 1 } })
  if (!clinic?.enableDigitalSignature) return { signed: false, pdf: input.pdf }

  const defaultReason =
    input.documentType === "Prescription"
      ? "Prescrição médica"
      : "Plano terapêutico"
  const reason = input.reason ?? defaultReason

  // Certificado em nuvem Bird ID tem precedência sobre o A1. Ordem:
  // 1) sessão signature_session ativa → assinatura síncrona, sem push;
  // 2) senão, push aprovado no app a cada documento.
  // Falha (recusa, tempo esgotado, serviço fora) cai no fallback SEM
  // assinatura — nunca troca silenciosamente para o A1, para o médico
  // saber o que está assinando.
  const birdId = await getActiveBirdIdCredential(input.doctorId)
  if (birdId) {
    const certPem = decryptSecret(birdId.encryptedCertPem).toString("utf8")
    const birdIdConfig = await getBirdIdConfig()
    const message = input.patientName
      ? `${reason} — paciente ${input.patientName}`
      : reason

    const birdIdSession = await getActiveBirdIdSession(input.doctorId)
    if (birdIdSession) {
      try {
        const sessionToken = decryptSecret(birdIdSession.encryptedToken).toString("utf8")
        const signed = await signPdfSessionWithSigner({
          pdf: input.pdf,
          certPem,
          alias: birdId.alias,
          sessionToken,
          doctorName: input.doctorName ?? "Médico",
          reason,
          userId: input.doctorId ?? "",
          birdIdBaseUrl: birdIdConfig.baseUrl,
        })
        await prisma.$transaction([
          prisma.birdIdSession.update({
            where: { id: birdIdSession.id },
            data: { lastUsedAt: new Date() },
          }),
          prisma.auditLog.create({
            data: {
              userId: input.actorId ?? null,
              action: "SIGN",
              entity: input.documentType,
              entityId: input.documentId ?? null,
              patientId: input.patientId ?? null,
              details: {
                method: "birdid-session",
                certificateId: birdId.id,
                serialNumber: birdId.serialNumber,
                level: signed.level,
              },
            },
          }),
        ])
        return { signed: true, pdf: signed.pdf }
      } catch (error) {
        // Sessão inválida/expirada → marca EXPIRED e tenta o push; outro
        // erro → mantém a sessão e também tenta o push (o médico aprova
        // no app e o documento não fica sem assinatura por isso).
        if (error instanceof BirdIdSessionExpiredError) {
          await prisma.birdIdSession
            .updateMany({
              where: { id: birdIdSession.id, status: "ACTIVE" },
              data: { status: "EXPIRED" },
            })
            .catch(() => null)
        }
        console.error(
          `[Assinatura] Falha na assinatura por sessão de ${input.documentType} (fallback para push):`,
          error
        )
      }
    }

    try {
      const signed = await signPdfCloudWithSigner({
        pdf: input.pdf,
        certPem,
        cpf: birdId.cpf,
        message,
        doctorName: input.doctorName ?? "Médico",
        reason,
        userId: input.doctorId ?? "",
        birdIdBaseUrl: birdIdConfig.baseUrl,
        birdIdClientId: birdIdConfig.clientId,
        birdIdClientSecret: birdIdConfig.clientSecret,
      })
      await prisma.auditLog.create({
        data: {
          userId: input.actorId ?? null,
          action: "SIGN",
          entity: input.documentType,
          entityId: input.documentId ?? null,
          patientId: input.patientId ?? null,
          details: {
            method: "birdid-push",
            certificateId: birdId.id,
            serialNumber: birdId.serialNumber,
            level: signed.level,
          },
        },
      })
      return { signed: true, pdf: signed.pdf }
    } catch (error) {
      console.error(
        `[Assinatura] Falha na assinatura em nuvem de ${input.documentType} (fallback sem assinatura):`,
        error
      )
      return { signed: false, pdf: input.pdf }
    }
  }

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
      reason,
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
