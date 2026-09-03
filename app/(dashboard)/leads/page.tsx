import type { Metadata } from "next"
import Link from "next/link"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { MessageCircle } from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
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
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CopyLeadLink } from "./copy-lead-link"

export const metadata: Metadata = { title: "Leads" }

const STATUS_LABELS: Record<string, string> = {
  AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
  AGENDADO: "Agendada",
  REALIZADO: "Realizada",
  CANCELADO: "Cancelada",
}

const baseUrl =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://painel.medicoemdomicilio.com"

/**
 * Tela de conversão: separa quem falou com o bot e ainda não é paciente
 * (lead) de quem já finalizou o agendamento online (paciente).
 */
export default async function LeadsPage() {
  const session = await auth()
  requireRole(session, ["ADMIN", "SECRETARIA"])

  const [leads, pacientes] = await Promise.all([
    prisma.whatsAppContact.findMany({
      where: { converted: false },
      orderBy: { lastMessageAt: "desc" },
      take: 100,
    }),
    prisma.patient.findMany({
      where: {
        OR: [
          { registeredVia: "ONLINE" },
          { attendances: { some: { origin: "ONLINE" } } },
        ],
      },
      include: {
        attendances: {
          where: { origin: "ONLINE", status: { not: "CANCELADO" } },
          orderBy: { scheduledAt: "asc" },
          take: 1,
          select: { id: true, scheduledAt: true, status: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
        <p className="text-muted-foreground">
          Quem falou com o bot e ainda não é paciente, separado de quem já
          finalizou o agendamento online
        </p>
      </div>

      <Tabs defaultValue="leads">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="leads">Leads ({leads.length})</TabsTrigger>
          <TabsTrigger value="pacientes">
            Pacientes ({pacientes.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="leads" className="pt-4">
          {leads.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                Nenhum lead por aqui ainda. Quando alguém mandar mensagem para
                o bot sem ser paciente, aparece nesta lista.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Contatos do WhatsApp</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Telefone</TableHead>
                      <TableHead className="hidden sm:table-cell">
                        Última mensagem
                      </TableHead>
                      <TableHead className="hidden md:table-cell">
                        Follow-up
                      </TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leads.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell className="font-medium">
                          {lead.name ?? "Sem nome"}
                        </TableCell>
                        <TableCell>
                          <a
                            href={`https://wa.me/${lead.phone}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            {lead.phone}
                          </a>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {format(lead.lastMessageAt, "dd/MM/yyyy 'às' HH:mm", {
                            locale: ptBR,
                          })}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <Badge variant="outline">
                            Etapa {lead.followUpStage}
                          </Badge>
                        </TableCell>
                        <TableCell className="flex justify-end gap-2">
                          <CopyLeadLink
                            link={`${baseUrl}/cadastro?lead=${lead.id}`}
                          />
                          <a
                            href={`https://wa.me/${lead.phone}`}
                            target="_blank"
                            rel="noreferrer"
                            className={cn(
                              buttonVariants({ variant: "outline", size: "sm" })
                            )}
                          >
                            <MessageCircle className="h-4 w-4" />
                            <span className="ml-2">Conversa</span>
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="pacientes" className="pt-4">
          {pacientes.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                Nenhum paciente online ainda. Quando um lead concluir o
                cadastro e o agendamento, aparece nesta lista.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Pacientes com agendamento online
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Telefone</TableHead>
                      <TableHead className="hidden sm:table-cell">
                        Cadastro em
                      </TableHead>
                      <TableHead className="hidden md:table-cell">
                        1ª consulta
                      </TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pacientes.map((paciente) => {
                      const proxima = paciente.attendances[0]
                      return (
                        <TableRow key={paciente.id}>
                          <TableCell className="font-medium">
                            <Link
                              href={`/pacientes/${paciente.id}`}
                              className="text-primary hover:underline"
                            >
                              {paciente.name}
                            </Link>
                          </TableCell>
                          <TableCell>{paciente.phone}</TableCell>
                          <TableCell className="hidden sm:table-cell">
                            {format(paciente.createdAt, "dd/MM/yyyy", {
                              locale: ptBR,
                            })}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            {proxima
                              ? format(
                                  proxima.scheduledAt,
                                  "dd/MM/yyyy 'às' HH:mm",
                                  { locale: ptBR }
                                )
                              : "Não agendou"}
                          </TableCell>
                          <TableCell>
                            {proxima ? (
                              <Badge variant="secondary">
                                {STATUS_LABELS[proxima.status] ??
                                  proxima.status}
                              </Badge>
                            ) : (
                              <Badge variant="outline">Cadastro criado</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
