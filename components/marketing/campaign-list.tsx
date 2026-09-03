/**
 * Lista de campanhas de marketing (server component, só ADMIN).
 * Mostra status, público, horário e progresso; ações de editar/cancelar.
 */
import Link from "next/link"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  CAMPAIGN_STATUS_LABELS,
  TONE_LABELS,
} from "@/lib/marketing/labels"
import { normalizeAudience } from "@/lib/marketing/service"
import { CancelCampaignButton } from "./cancel-campaign-button"
import type { DoctorOption } from "@/lib/doctor"

/** Linha da campanha (tipo estrutural — evita acoplar ao client do Prisma). */
type CampaignRow = {
  id: string
  name: string
  tone: string
  status: string
  scheduledFor: Date
  sentCount: number
  failedCount: number
  audience: unknown
}

const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  RASCUNHO: "outline",
  AGENDADA: "secondary",
  ENVIANDO: "default",
  CONCLUIDA: "default",
  CANCELADA: "destructive",
}

function audienceText(
  campaign: CampaignRow,
  doctors: DoctorOption[]
): string {
  const audience = normalizeAudience(campaign.audience)
  let text: string
  if (audience.kind === "MEDICO") {
    const doctor = doctors.find((d) => d.id === audience.doctorId)
    text = doctor ? `Pacientes do(a) ${doctor.name}` : "Pacientes por médico"
  } else if (audience.kind === "ATIVOS") {
    text = `Ativos nos últimos ${audience.days ?? 90} dias`
  } else if (audience.kind === "LEADS") {
    text = "Leads (ainda não são pacientes)"
  } else {
    text = "Todos os pacientes"
  }
  const total =
    typeof audience.total === "number" ? ` (${audience.total})` : ""
  return `${text}${total}`
}

export function CampaignList({
  campaigns,
  doctors,
}: {
  campaigns: CampaignRow[]
  doctors: DoctorOption[]
}) {
  if (campaigns.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Nenhuma campanha ainda. Crie a primeira acima para avisar seus
        pacientes pelo WhatsApp.
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead className="hidden md:table-cell">Tom</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden lg:table-cell">Público</TableHead>
            <TableHead className="hidden md:table-cell">Envio</TableHead>
            <TableHead className="text-right">Enviadas</TableHead>
            <TableHead className="text-right">Falhas</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {campaigns.map((campaign) => (
            <TableRow key={campaign.id}>
              <TableCell className="font-medium">{campaign.name}</TableCell>
              <TableCell className="hidden md:table-cell">
                {TONE_LABELS[campaign.tone] ?? campaign.tone}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_BADGE_VARIANT[campaign.status] ?? "outline"}>
                  {CAMPAIGN_STATUS_LABELS[campaign.status] ?? campaign.status}
                </Badge>
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                {audienceText(campaign, doctors)}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {format(campaign.scheduledFor, "dd/MM/yyyy HH:mm", {
                  locale: ptBR,
                })}
              </TableCell>
              <TableCell className="text-right">{campaign.sentCount}</TableCell>
              <TableCell className="text-right">{campaign.failedCount}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  {(campaign.status === "RASCUNHO" ||
                    campaign.status === "AGENDADA") && (
                    <Button
                      variant="outline"
                      className="h-8"
                      render={
                        <Link href={`/marketing?edit=${campaign.id}`}>
                          Editar
                        </Link>
                      }
                    />
                  )}
                  {(campaign.status === "RASCUNHO" ||
                    campaign.status === "AGENDADA" ||
                    campaign.status === "ENVIANDO") && (
                    <CancelCampaignButton campaignId={campaign.id} />
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
