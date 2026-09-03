import type { Metadata } from "next"
import { format } from "date-fns"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { listActiveDoctors } from "@/lib/doctor"
import { normalizeAudience } from "@/lib/marketing/service"
import { CampaignForm } from "@/components/marketing/campaign-form"
import { CampaignList } from "@/components/marketing/campaign-list"

export const metadata: Metadata = { title: "Marketing" }

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>
}) {
  requireRole(await auth(), ["ADMIN"])

  const { edit } = await searchParams
  const [campaigns, doctors] = await Promise.all([
    prisma.marketingCampaign.findMany({ orderBy: { createdAt: "desc" } }),
    listActiveDoctors(),
  ])

  const editing = edit ? campaigns.find((c) => c.id === edit) : undefined

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Marketing</h1>
        <p className="text-muted-foreground">
          Campanhas de mensagem em massa pelo WhatsApp — alcançam pacientes
          com WhatsApp habilitado, telefone e consentimento LGPD, e também
          leads capturados pelo bot que ainda não viraram pacientes.
        </p>
      </div>

      <CampaignForm
        doctors={doctors}
        initial={
          editing
            ? {
                id: editing.id,
                name: editing.name,
                tone: editing.tone,
                body: editing.body,
                linkUrl: editing.linkUrl ?? "",
                imageDataUrl: editing.imageDataUrl ?? "",
                scheduledAt: format(editing.scheduledFor, "yyyy-MM-dd'T'HH:mm"),
                audienceKind: normalizeAudience(editing.audience).kind,
                audienceDoctorId:
                  normalizeAudience(editing.audience).doctorId ?? "",
                audienceDays: String(
                  normalizeAudience(editing.audience).days ?? ""
                ),
                status: editing.status,
              }
            : undefined
        }
      />

      <CampaignList campaigns={campaigns} doctors={doctors} />
    </div>
  )
}
