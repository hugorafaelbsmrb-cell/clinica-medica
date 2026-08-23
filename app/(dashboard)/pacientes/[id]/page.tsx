import Link from "next/link"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import {
  ArrowLeft,
  Navigation,
  Pencil,
  Phone,
  MapPin,
  HeartPulse,
} from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { getPaymentSettings } from "@/lib/payments/settings"
import { mapsNavigationUrl, mapsSearchUrl } from "@/lib/geo"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { CobrarPacienteButton } from "@/components/pacientes/cobrar-paciente-button"
import { MarcarAcompanhamentoButton } from "@/components/acompanhamentos/marcar-acompanhamento-button"

export const metadata: Metadata = { title: "Detalhes do paciente" }

const TYPE_LABELS = {
  PRESENCIAL: "Presencial",
  DOMICILIAR: "Domiciliar",
  TELECONSULTA: "Teleconsulta",
} as const

const STATUS_LABELS = {
  AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
  AGENDADO: "Agendado",
  EM_ATENDIMENTO: "Em atendimento",
  REALIZADO: "Realizado",
  CANCELADO: "Cancelado",
} as const

export default async function PacienteDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = requireRole(
    await auth(),
    ["ADMIN", "MEDICO", "SECRETARIA"]
  )

  const { id } = await params
  const [patient, paymentSettings] = await Promise.all([
    prisma.patient.findUnique({
      where: { id },
      include: {
        followUp: true,
        followUpPrograms: { orderBy: { createdAt: "desc" } },
        attendances: { orderBy: { scheduledAt: "desc" }, take: 10 },
        messages: { orderBy: { createdAt: "desc" }, take: 10 },
        prescriptions: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { items: true },
        },
      },
    }),
    getPaymentSettings(),
  ])

  if (!patient) notFound()

  // Programa de acompanhamento ativo (ATIVO ou PAUSADO), se existir.
  const activeProgram = patient.followUpPrograms.find(
    (program) => program.status === "ATIVO" || program.status === "PAUSADO"
  )
  const canManageFollowUp =
    session.user.role === "ADMIN" || session.user.role === "MEDICO"

  const address = [
    patient.street,
    patient.number,
    patient.neighborhood,
    patient.city,
    patient.state,
  ]
    .filter(Boolean)
    .join(", ")

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            render={<Link href="/pacientes" />}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {patient.name}
            </h1>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              {patient.cpf && <span>{patient.cpf}</span>}
              {patient.neighborhood && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {patient.neighborhood}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {activeProgram && canManageFollowUp ? (
            <Button
              variant="outline"
              render={<Link href={`/acompanhamentos/${activeProgram.id}`} />}
            >
              <HeartPulse className="h-4 w-4" />
              Em acompanhamento
            </Button>
          ) : activeProgram ? (
            <Badge variant="secondary" className="h-9 px-3">
              <HeartPulse className="mr-1 h-4 w-4" />
              Em acompanhamento
            </Badge>
          ) : canManageFollowUp ? (
            <MarcarAcompanhamentoButton
              patientId={patient.id}
              patientName={patient.name}
              sugestaoBaixa={
                paymentSettings.acompValorBaixa > 0
                  ? paymentSettings.acompValorBaixa
                  : null
              }
              sugestaoMedia={
                paymentSettings.acompValorMedia > 0
                  ? paymentSettings.acompValorMedia
                  : null
              }
              sugestaoAlta={
                paymentSettings.acompValorAlta > 0
                  ? paymentSettings.acompValorAlta
                  : null
              }
              jurosParcelamento={paymentSettings.jurosParcelamento}
            />
          ) : null}
          <CobrarPacienteButton
            patientId={patient.id}
            patientName={patient.name}
            sugestaoValor={
              paymentSettings.consultaPrecoPresencial > 0
                ? paymentSettings.consultaPrecoPresencial
                : paymentSettings.consultaPrecoDomiciliar > 0
                  ? paymentSettings.consultaPrecoDomiciliar
                  : null
            }
          />
          <Button
            variant="outline"
            render={
              <a
                href={
                  patient.latitude != null && patient.longitude != null
                    ? mapsNavigationUrl(patient.latitude, patient.longitude)
                    : mapsSearchUrl(address)
                }
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <Navigation className="h-4 w-4" />
            Navegar
          </Button>
          <Button
            variant="outline"
            render={<Link href={`/pacientes/${patient.id}/editar`} />}
          >
            <Pencil className="h-4 w-4" />
            Editar
          </Button>
          <Button render={<Link href={`/atendimentos/novo?paciente=${patient.id}`} />}>
            Novo atendimento
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dados do paciente</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {patient.phone && (
              <p className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                {patient.phone}
              </p>
            )}
            {patient.email && <p>{patient.email}</p>}
            {patient.birthDate && (
              <p>
                Nascimento:{" "}
                {format(patient.birthDate, "dd/MM/yyyy", { locale: ptBR })}
              </p>
            )}
            {patient.insurance && <p>Convênio: {patient.insurance}</p>}
            {address && <p className="text-muted-foreground">{address}</p>}
            {patient.notes && (
              <>
                <Separator />
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {patient.notes}
                </p>
              </>
            )}
            {patient.consultationReason && (
              <>
                <Separator />
                <div>
                  <p className="font-medium">Motivo da consulta</p>
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {patient.consultationReason}
                  </p>
                </div>
              </>
            )}
            <Separator />
            <div className="flex flex-wrap gap-2">
              <Badge variant={patient.lgpdConsent ? "secondary" : "outline"}>
                LGPD: {patient.lgpdConsent ? "Consentido" : "Sem consentimento"}
              </Badge>
              <Badge variant={patient.whatsappEnabled ? "secondary" : "outline"}>
                WhatsApp: {patient.whatsappEnabled ? "Ativo" : "Inativo"}
              </Badge>
            </div>
            {patient.followUp?.active && (
              <p className="text-xs text-muted-foreground">
                Acompanhamento de saúde a cada {patient.followUp.intervalDays} dias
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Histórico</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="atendimentos">
              <TabsList>
                <TabsTrigger value="atendimentos">
                  Atendimentos ({patient.attendances.length})
                </TabsTrigger>
                <TabsTrigger value="prescricoes">
                  Prescrições ({patient.prescriptions.length})
                </TabsTrigger>
                <TabsTrigger value="mensagens">
                  Mensagens ({patient.messages.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="atendimentos" className="flex flex-col gap-3 pt-4">
                {patient.attendances.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum atendimento registrado ainda.
                  </p>
                ) : (
                  patient.attendances.map((attendance) => (
                    <Link
                      key={attendance.id}
                      href={`/atendimentos/${attendance.id}`}
                      className="flex items-center justify-between rounded-lg border p-3 text-sm hover:bg-muted/50"
                    >
                      <div>
                        <p className="font-medium">
                          {format(attendance.scheduledAt, "dd/MM/yyyy HH:mm", {
                            locale: ptBR,
                          })}
                        </p>
                        <p className="text-muted-foreground">
                          {TYPE_LABELS[attendance.type]}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {STATUS_LABELS[attendance.status]}
                      </Badge>
                    </Link>
                  ))
                )}
              </TabsContent>

              <TabsContent value="prescricoes" className="flex flex-col gap-3 pt-4">
                {patient.prescriptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma prescrição registrada ainda.
                  </p>
                ) : (
                  patient.prescriptions.map((prescription) => (
                    <Link
                      key={prescription.id}
                      href={`/prescricoes/${prescription.id}`}
                      className="flex items-center justify-between rounded-lg border p-3 text-sm hover:bg-muted/50"
                    >
                      <p>
                        {format(prescription.createdAt, "dd/MM/yyyy", {
                          locale: ptBR,
                        })}{" "}
                        — {prescription.items.length} item(ns)
                      </p>
                    </Link>
                  ))
                )}
              </TabsContent>

              <TabsContent value="mensagens" className="flex flex-col gap-3 pt-4">
                {patient.messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma mensagem enviada ainda.
                  </p>
                ) : (
                  patient.messages.map((message) => (
                    <div
                      key={message.id}
                      className="rounded-lg border p-3 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                          {format(message.createdAt, "dd/MM/yyyy HH:mm", {
                            locale: ptBR,
                          })}
                        </p>
                        <Badge variant="outline">{message.status}</Badge>
                      </div>
                      <p className="mt-1">{message.content}</p>
                    </div>
                  ))
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
