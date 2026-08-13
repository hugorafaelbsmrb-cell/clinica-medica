import type { Metadata } from "next"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { getIntegrationSettings } from "@/lib/integrations"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { SendMessageForm } from "./send-message-form"
import { TemplateForm } from "./template-form"
import { FollowUpRow } from "./follow-up-row"

export const metadata: Metadata = { title: "WhatsApp" }

const STATUS_LABELS: Record<string, string> = {
  PENDENTE: "Pendente",
  ENVIADA: "Enviada",
  ENTREGUE: "Entregue",
  LIDA: "Lida",
  FALHA: "Falha",
}

const TYPE_LABELS: Record<string, string> = {
  PRIMEIRO_CONTATO: "Primeiro contato",
  ACOMPANHAMENTO: "Acompanhamento",
  MANUAL: "Manual",
  RESPOSTA: "Resposta",
  DOCUMENTO: "Documento",
}

export default async function WhatsAppPage() {
  const session = await auth()
  requireRole(session, ["ADMIN", "SECRETARIA"])

  const [messages, templates, followUps, patients] = await Promise.all([
    prisma.message.findMany({
      include: { patient: true },
      orderBy: [{ needsAttention: "desc" }, { createdAt: "desc" }],
      take: 50,
    }),
    prisma.messageTemplate.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.followUpConfig.findMany({
      include: { patient: true },
      orderBy: { nextDueAt: "asc" },
    }),
    prisma.patient.findMany({
      where: { whatsappEnabled: true, phone: { not: null } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    }),
  ])

  const integrations = await getIntegrationSettings()
  const provider =
    integrations.wApiToken && integrations.wApiInstance ? "wapi" : "mock"

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">WhatsApp</h1>
          <p className="text-muted-foreground">
            Contato inicial, acompanhamentos periódicos e histórico de mensagens
          </p>
        </div>
        <Badge variant={provider === "wapi" ? "secondary" : "outline"}>
          Provedor: {provider === "wapi" ? "W-API conectada" : "Simulação (mock)"}
        </Badge>
      </div>

      <Tabs defaultValue="mensagens">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="mensagens">Mensagens</TabsTrigger>
          <TabsTrigger value="enviar">Enviar manual</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="acompanhamentos">Acompanhamentos</TabsTrigger>
        </TabsList>

        <TabsContent value="mensagens" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Histórico de mensagens</CardTitle>
            </CardHeader>
            <CardContent>
              {messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma mensagem registrada ainda.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Paciente</TableHead>
                      <TableHead className="hidden md:table-cell">Tipo</TableHead>
                      <TableHead className="hidden sm:table-cell">Direção</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden lg:table-cell">Mensagem</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {messages.map((message) => (
                      <TableRow
                        key={message.id}
                        className={
                          message.needsAttention ? "bg-amber-500/10" : undefined
                        }
                      >
                        <TableCell className="whitespace-nowrap">
                          {format(message.createdAt, "dd/MM HH:mm", { locale: ptBR })}
                        </TableCell>
                        <TableCell>{message.patient.name}</TableCell>
                        <TableCell className="hidden md:table-cell">
                          {TYPE_LABELS[message.type] ?? message.type}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {message.direction === "IN" ? "Recebida" : "Enviada"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge
                              variant={message.status === "FALHA" ? "destructive" : "outline"}
                            >
                              {STATUS_LABELS[message.status] ?? message.status}
                            </Badge>
                            {message.needsAttention && (
                              <Badge variant="destructive">Pediu atendente</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden max-w-xs truncate lg:table-cell">
                          {message.content}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="enviar" className="pt-4">
          <SendMessageForm patients={patients} />
        </TabsContent>

        <TabsContent value="templates" className="pt-4">
          <div className="flex flex-col gap-6 lg:flex-row">
            <Card className="flex-1">
              <CardHeader>
                <CardTitle className="text-base">Templates cadastrados</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {templates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum template.</p>
                ) : (
                  templates.map((template) => (
                    <div key={template.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{template.name}</p>
                        <Badge variant="outline">{TYPE_LABELS[template.type]}</Badge>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                        {template.body}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
            <Card className="flex-1">
              <CardHeader>
                <CardTitle className="text-base">Novo template</CardTitle>
              </CardHeader>
              <CardContent>
                <TemplateForm />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="acompanhamentos" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Acompanhamento periódico de saúde
              </CardTitle>
            </CardHeader>
            <CardContent>
              {followUps.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum acompanhamento configurado. Cadastre pacientes com
                  WhatsApp habilitado e ative o acompanhamento aqui.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Paciente</TableHead>
                      <TableHead className="hidden sm:table-cell">Intervalo</TableHead>
                      <TableHead>Próximo envio</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {followUps.map((config) => (
                      <FollowUpRow
                        key={config.id}
                        patientId={config.patientId}
                        name={config.patient.name}
                        active={config.active}
                        intervalDays={config.intervalDays}
                        nextDueAt={config.nextDueAt}
                      />
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
