import type { Metadata } from "next"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { getClinicSettings } from "@/lib/clinic"
import { getIntegrationSettings } from "@/lib/integrations"
import { parseFlowEdges, parseFlowNodes } from "@/lib/whatsapp/flow-types"
import { BotForm } from "@/components/automacoes/bot-form"
import { FluxosManagerLoader } from "@/components/automacoes/fluxos-manager-loader"
import type { FluxoData } from "@/components/automacoes/fluxos-canvas"

export const metadata: Metadata = { title: "Automações" }

export default async function AutomacoesPage() {
  const session = requireRole(await auth(), ["ADMIN"])
  void session
  const [clinic, integrations, flows] = await Promise.all([
    getClinicSettings(),
    getIntegrationSettings(),
    prisma.messageFlow.findMany({
      orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
    }),
  ])

  const fluxos: FluxoData[] = flows.map((flow) => ({
    id: flow.id,
    kind: flow.kind,
    name: flow.name,
    description: flow.description,
    enabled: flow.enabled,
    nodes: parseFlowNodes(flow.nodes),
    edges: parseFlowEdges(flow.edges),
  }))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Automações</h1>
        <p className="text-muted-foreground">
          Fluxos de mensagens do WhatsApp no estilo n8n — bot de atendimento,
          automações e jornadas em um único diagrama
        </p>
      </div>
      <BotForm
        initial={{
          botEnabled: clinic.botEnabled ?? true,
          botPauseHours: clinic.botPauseHours ?? 24,
          botMsgAtendente: clinic.botMsgAtendente ?? "",
          botMsgSaude: clinic.botMsgSaude ?? "",
          botMsgCpfNaoEncontrado: clinic.botMsgCpfNaoEncontrado ?? "",
          botMsgBoasVindas: clinic.botMsgBoasVindas ?? "",
          botMsgAgendar: clinic.botMsgAgendar ?? "",
        }}
      />
      <FluxosManagerLoader
        flows={fluxos}
        mediaConfigured={!!integrations.mediaApiKey}
      />
    </div>
  )
}
