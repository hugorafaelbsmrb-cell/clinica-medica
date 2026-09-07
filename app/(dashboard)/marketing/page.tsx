import type { Metadata } from "next"
import { format } from "date-fns"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { listActiveDoctors } from "@/lib/doctor"
import { normalizeAudience } from "@/lib/marketing/service"
import { CampaignForm } from "@/components/marketing/campaign-form"
import { CampaignList } from "@/components/marketing/campaign-list"
import { CouponsSection } from "@/components/marketing/coupons-section"

export const metadata: Metadata = { title: "Marketing" }

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>
}) {
  requireRole(await auth(), ["ADMIN"])

  const { edit } = await searchParams
  const [campaigns, doctors, coupons] = await Promise.all([
    prisma.marketingCampaign.findMany({ orderBy: { createdAt: "desc" } }),
    listActiveDoctors(),
    prisma.coupon.findMany({ orderBy: { createdAt: "desc" } }),
  ])

  const editing = edit ? campaigns.find((c) => c.id === edit) : undefined
  const activeCoupons = coupons.filter((c) => c.enabled)

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
        coupons={activeCoupons.map((c) => ({
          id: c.id,
          code: c.code,
          enabled: c.enabled,
        }))}
        initial={
          editing
            ? {
                id: editing.id,
                name: editing.name,
                tone: editing.tone,
                body: editing.body,
                linkUrl: editing.linkUrl ?? "",
                imageDataUrl: editing.imageDataUrl ?? "",
                couponId: editing.couponId ?? "",
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

      <CouponsSection
        coupons={coupons.map((c) => ({
          id: c.id,
          code: c.code,
          description: c.description,
          discountType: c.discountType,
          discountValue: Number(c.discountValue),
          minValue: c.minValue != null ? Number(c.minValue) : null,
          maxDiscount: c.maxDiscount != null ? Number(c.maxDiscount) : null,
          validFrom: c.validFrom,
          validUntil: c.validUntil,
          maxUses: c.maxUses,
          usedCount: c.usedCount,
          enabled: c.enabled,
        }))}
      />
    </div>
  )
}
