import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { getClinicSettings } from "@/lib/clinic"
import { SignatureForm } from "@/components/usuarios/signature-form"
import { CertificateForm } from "@/components/usuarios/certificate-form"

export const metadata: Metadata = { title: "Minha assinatura" }

export default async function MinhaAssinaturaPage() {
  const session = requireRole(await auth(), ["ADMIN", "MEDICO"])

  const [user, clinic] = await Promise.all([
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
  ])
  if (!user) notFound()

  const activeCertificate = await prisma.medicalCertificate.findFirst({
    where: { userId: session.user.id, status: "ACTIVE" },
    orderBy: { uploadedAt: "desc" },
  })

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
          clinicEnabled: clinic.enableDigitalSignature ?? false,
        }}
      />
    </div>
  )
}
