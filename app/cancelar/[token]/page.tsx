import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import {
  CalendarCheck2,
  CalendarClock,
  History,
  HeartPulse,
  Phone,
} from "lucide-react"
import { getClinicSettings } from "@/lib/clinic"
import { getConsultasPublicas } from "@/lib/actions/agendamento-publico"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RemarcarConsulta } from "@/components/agenda/remarcar-consulta"
import { CancelarConsultaButton } from "@/components/agenda/cancelar-consulta-button"

export const metadata: Metadata = { title: "Minhas consultas" }

const STATUS_LABEL: Record<string, string> = {
  AGENDADO: "Agendada",
  REALIZADO: "Realizada",
  CANCELADO: "Cancelada",
}

function formatFullDate(iso: string): string {
  return format(new Date(iso), "EEEE, dd 'de' MMMM 'de' yyyy", {
    locale: ptBR,
  })
}

function formatTime(iso: string): string {
  return format(new Date(iso), "HH:mm", { locale: ptBR })
}

/**
 * Página pública do paciente (acessada pelo link enviado na confirmação):
 * mostra a próxima consulta e a última consulta, permite alterar data e
 * horário (remarcar) e cancelar.
 */
export default async function ConsultasPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const consultas = await getConsultasPublicas(token)
  if (!consultas.found) notFound()

  const clinic = await getClinicSettings()
  const next = consultas.next

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4 py-10">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        {clinic.logoDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={clinic.logoDataUrl}
            alt={clinic.name}
            className="h-20 w-20 rounded-full border bg-background object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
            <HeartPulse className="h-10 w-10 text-primary" />
          </div>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{clinic.name}</h1>
        <p className="text-lg text-muted-foreground">
          Olá, {consultas.firstName}! Suas consultas
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-4">
        {/* Próxima consulta */}
        <Card>
          <CardContent className="flex flex-col gap-4 py-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <CalendarCheck2 className="h-5 w-5 text-primary" />
                Próxima consulta
              </h2>
              {next && (
                <Badge>
                  {STATUS_LABEL[next.status] ?? next.status}
                </Badge>
              )}
            </div>

            {next ? (
              <>
                <div className="rounded-xl border-2 border-border p-4 text-center">
                  <p className="text-lg font-semibold capitalize">
                    {formatFullDate(next.scheduledAt)}
                  </p>
                  <p className="text-3xl font-bold text-primary">
                    {formatTime(next.scheduledAt)}
                  </p>
                  {next.slotNote && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Motivo: {next.slotNote}
                    </p>
                  )}
                </div>
                <RemarcarConsulta token={next.cancelToken} />
                <CancelarConsultaButton token={next.cancelToken} />
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <p className="text-muted-foreground">
                  Você não tem consultas agendadas no momento.
                </p>
                <Button
                  render={<Link href="/cadastro" />}
                  className="h-12 w-full text-base"
                >
                  <CalendarClock className="h-5 w-5" />
                  Agendar nova consulta
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Última consulta */}
        {consultas.last && (
          <Card>
            <CardContent className="flex flex-col gap-3 py-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <History className="h-5 w-5 text-muted-foreground" />
                Última consulta
              </h2>
              <div className="flex items-center justify-between gap-3 rounded-xl border-2 border-border p-4">
                <div>
                  <p className="text-base font-semibold capitalize">
                    {formatFullDate(consultas.last.scheduledAt)}
                  </p>
                  <p className="text-xl font-bold text-primary">
                    {formatTime(consultas.last.scheduledAt)}
                  </p>
                  {consultas.last.slotNote && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Motivo: {consultas.last.slotNote}
                    </p>
                  )}
                </div>
                <Badge variant="secondary">
                  {STATUS_LABEL[consultas.last.status] ??
                    consultas.last.status}
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Phone className="h-4 w-4" />
          Precisa de ajuda? Ligue para a clínica.
        </p>
      </div>
    </main>
  )
}
