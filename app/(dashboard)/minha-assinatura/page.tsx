import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { getClinicSettings } from "@/lib/clinic"
import { SignatureForm } from "@/components/usuarios/signature-form"
import { CertificateForm } from "@/components/usuarios/certificate-form"

export const metadata: Metadata = { title: "Minha assinatura" }

type Notice = { type: "success" | "error"; message: string }

function birdIdNotice(
  result: string | undefined,
  motivo: string | undefined
): Notice | null {
  if (result === "ok") {
    return { type: "success", message: "Certificado Bird ID conectado com sucesso" }
  }
  if (result !== "erro") return null
  const messages: Record<string, string> = {
    icp: "Certificado do Bird ID recusado: não valida contra a ICP-Brasil",
    negado: "Conexão Bird ID cancelada",
    cpf: "CPF inválido — informe os 11 dígitos",
    sessao: "Sessão expirada — tente conectar o Bird ID novamente",
    vencido: "Certificado do Bird ID fora da validade",
    "nao-configurado": "Conexão Bird ID ainda não configurada para esta clínica",
    servico: "Não foi possível validar o certificado (serviço de assinatura indisponível)",
  }
  return {
    type: "error",
    message: messages[motivo ?? ""] ?? "Não foi possível conectar o Bird ID",
  }
}

export default async function MinhaAssinaturaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = requireRole(await auth(), ["ADMIN", "MEDICO"])
  const query = await searchParams

  const [user, clinic, activeCertificate, birdIdCredential, birdIdSession] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        crm: true,
        meetLink: true,
        signatureText: true,
        signatureImage: true,
      },
    }),
    getClinicSettings(),
    prisma.medicalCertificate.findFirst({
      where: { userId: session.user.id, status: "ACTIVE" },
      orderBy: { uploadedAt: "desc" },
    }),
    prisma.birdIdCredential.findFirst({
      where: { userId: session.user.id, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.birdIdSession.findFirst({
      where: { userId: session.user.id, status: "ACTIVE", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ])
  if (!user) notFound()

  const birdIdConfigured = Boolean(
    process.env.BIRDID_CLIENT_ID && process.env.BIRDID_CLIENT_SECRET
  )
  const notice = birdIdNotice(
    typeof query.birdid === "string" ? query.birdid : undefined,
    typeof query.motivo === "string" ? query.motivo : undefined
  )

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Minha assinatura
        </h1>
        <p className="text-muted-foreground">
          Assinatura virtual usada nos prontuários, prescrições e planos
          terapêuticos. Quando o administrador seleciona você como médico
          responsável, é esta assinatura que aparece no documento.
        </p>
      </div>
      <SignatureForm
        initial={{
          name: user.name,
          crm: user.crm,
          meetLink: user.meetLink,
          signatureText: user.signatureText,
          signatureImage: user.signatureImage,
        }}
      />
      <CertificateForm
        initial={{
          active: activeCertificate
            ? {
                subject: activeCertificate.subject,
                issuer: activeCertificate.issuer,
                serialNumber: activeCertificate.serialNumber,
                validFrom: activeCertificate.validFrom,
                validTo: activeCertificate.validTo,
              }
            : null,
          birdId: birdIdCredential
            ? {
                subject: birdIdCredential.subject,
                issuer: birdIdCredential.issuer,
                serialNumber: birdIdCredential.serialNumber,
                validFrom: birdIdCredential.validFrom,
                validTo: birdIdCredential.validTo,
                cpf: birdIdCredential.cpf,
                alias: birdIdCredential.alias,
              }
            : null,
          birdIdSession: birdIdSession
            ? {
                expiresAt: birdIdSession.expiresAt,
                lastUsedAt: birdIdSession.lastUsedAt,
              }
            : null,
          birdIdConfigured,
          clinicEnabled: clinic.enableDigitalSignature ?? false,
          notice,
        }}
      />
    </div>
  )
}
