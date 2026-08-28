"use client"

/**
 * Cartões do módulo "Atendimentos do dia" (home care, mobile-first).
 * Fechado, o cartão mostra apenas o horário e o nome do paciente, com
 * o botão principal "Iniciar atendimento". Ao iniciar (ou ao expandir),
 * aparecem os dados clínicos, a prescrição, o plano terapêutico e as
 * opções de navegação (Google Maps/Waze), ligação e WhatsApp.
 * Os cartões são sempre ordenados pelo horário do atendimento.
 */
import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Banknote,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  CarFront,
  FileText,
  History,
  List,
  Loader2,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  PlayCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import {
  mapsNavigationUrl,
  mapsSearchUrl,
  wazeNavigationUrl,
} from "@/lib/geo"
import {
  completeAttendance,
  confirmCashPayment,
  saveAttendanceAnamnesis,
  startAttendance,
} from "@/lib/actions/atendimentos"

export type DayCardData = {
  id: string
  status: "AGENDADO" | "EM_ATENDIMENTO" | "REALIZADO"
  scheduledAt: string
  startedAt: string | null
  type: "PRESENCIAL" | "DOMICILIAR" | "TELECONSULTA"
  patientId: string
  patientName: string
  doctorName: string | null
  age: number | null
  reason: string | null
  address: string
  phone: string | null
  latitude: number | null
  longitude: number | null
  medications: string[]
  planDiagnosis: string | null
  planSummary: string | null
  anamnesis: string | null
  value: number
  paymentMethod: string | null
  cashReceivedAt: string | null
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`
}

function formatMoney(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })
}

function DayCard({
  attendance,
  onStarted,
  onCompleted,
}: {
  attendance: DayCardData
  onStarted?: () => void
  onCompleted?: () => void
}) {
  const router = useRouter()
  // Atendimento já realizado: aparece como registro do dia, sem ação.
  const done = attendance.status === "REALIZADO"
  const [started, setStarted] = useState(
    attendance.status === "EM_ATENDIMENTO"
  )
  const [expanded, setExpanded] = useState(
    attendance.status === "EM_ATENDIMENTO"
  )
  const [busy, setBusy] = useState<"start" | "complete" | "cash" | null>(null)
  // Anamnese preenchida pelo médico durante o exame do paciente.
  const [anamnesis, setAnamnesis] = useState(attendance.anamnesis ?? "")
  const [savingAnamnesis, setSavingAnamnesis] = useState(false)
  // Recebimento em dinheiro já confirmado neste cartão.
  const [cashReceived, setCashReceived] = useState(
    attendance.cashReceivedAt !== null
  )

  const hasCoords =
    attendance.latitude !== null && attendance.longitude !== null
  const navigateUrl = hasCoords
    ? mapsNavigationUrl(attendance.latitude!, attendance.longitude!)
    : mapsSearchUrl(attendance.address)
  const wazeUrl = hasCoords
    ? wazeNavigationUrl(attendance.latitude!, attendance.longitude!)
    : null
  const phoneDigits = attendance.phone?.replace(/\D/g, "") ?? ""

  async function handleStart() {
    setBusy("start")
    const result = await startAttendance(attendance.id)
    setBusy(null)
    if (result.success) {
      setStarted(true)
      setExpanded(true)
      onStarted?.()
      toast.success(result.message)
      router.refresh()
    } else {
      toast.error(result.message)
    }
  }

  async function handleComplete() {
    setBusy("complete")
    const result = await completeAttendance(attendance.id)
    setBusy(null)
    if (result.success) {
      onCompleted?.()
      toast.success(result.message)
      router.refresh()
    } else {
      toast.error(result.message)
    }
  }

  async function handleConfirmCash() {
    setBusy("cash")
    const result = await confirmCashPayment(attendance.id)
    setBusy(null)
    if (result.success) {
      setCashReceived(true)
      toast.success(result.message)
      router.refresh()
    } else {
      toast.error(result.message)
    }
  }

  async function handleSaveAnamnesis() {
    setSavingAnamnesis(true)
    const result = await saveAttendanceAnamnesis(attendance.id, anamnesis)
    setSavingAnamnesis(false)
    if (result.success) {
      toast.success(result.message)
      router.refresh()
    } else {
      toast.error(result.message)
    }
  }

  return (
    <Card className={started ? "border-primary" : ""}>
      <CardContent className="flex flex-col gap-4 p-4">
        {/* Estado fechado: só horário + nome (botão de expandir à direita) */}
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-base font-semibold tabular-nums">
            <Clock className="h-4 w-4 text-muted-foreground" />
            {formatTime(attendance.scheduledAt)}
          </span>
          {started && <Badge>Em atendimento</Badge>}
          {done && <Badge variant="secondary">Realizado</Badge>}
          <p className="min-w-0 flex-1 truncate text-base font-semibold">
            {attendance.patientName}
          </p>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={expanded ? "Recolher cartão" : "Ver detalhes"}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>

        {attendance.doctorName && (
          <p className="-mt-2 text-xs text-muted-foreground">
            Médico(a): {attendance.doctorName}
          </p>
        )}

        {/* Ação principal: iniciar/finalizar atendimento (só para os pendentes) */}
        {!done &&
          (!started ? (
            <Button
              className="h-12 w-full text-base"
              onClick={handleStart}
              disabled={busy !== null}
            >
              {busy === "start" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <PlayCircle className="h-5 w-5" />
              )}
              {busy === "start" ? "Iniciando..." : "Iniciar atendimento"}
            </Button>
          ) : (
            <Button
              className="h-12 w-full text-base"
              onClick={handleComplete}
              disabled={busy !== null}
            >
              {busy === "complete" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-5 w-5" />
              )}
              {busy === "complete" ? "Finalizando..." : "Finalizar atendimento"}
            </Button>
          ))}

        {/* Demais opções: aparecem ao iniciar o atendimento (ou ao expandir) */}
        {expanded && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {attendance.type === "DOMICILIAR"
                  ? "Domiciliar"
                  : attendance.type === "TELECONSULTA"
                    ? "Teleconsulta"
                    : "Presencial"}
              </Badge>
              {attendance.age !== null && (
                <span className="text-sm text-muted-foreground">
                  {attendance.age} anos
                </span>
              )}
            </div>

            {attendance.reason && (
              <p className="text-sm text-muted-foreground">
                Motivo: {attendance.reason}
              </p>
            )}

            {/* Pagamento em dinheiro: o médico confirma o recebimento no
                local antes de finalizar o atendimento. */}
            {attendance.paymentMethod === "DINHEIRO" && !done && (
              <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
                <p className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
                  <Banknote className="h-4 w-4 shrink-0" />
                  Pagamento em dinheiro: R$ {formatMoney(attendance.value)}
                </p>
                {started && !cashReceived && (
                  <Button
                    variant="secondary"
                    className="h-11 w-full text-base"
                    onClick={handleConfirmCash}
                    disabled={busy !== null}
                  >
                    {busy === "cash" ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Banknote className="h-5 w-5" />
                    )}
                    {busy === "cash" ? "Confirmando..." : "Confirmar recebimento"}
                  </Button>
                )}
                {cashReceived && (
                  <p className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    Recebimento confirmado
                  </p>
                )}
              </div>
            )}

            {/* Anamnese: o médico registra enquanto examina o paciente,
                antes de prescrever ou montar o plano terapêutico. */}
            {started && !done && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Anamnese</p>
                  {attendance.anamnesis && (
                    <Badge variant="secondary">Salva</Badge>
                  )}
                </div>
                <Textarea
                  value={anamnesis}
                  onChange={(event) => setAnamnesis(event.target.value)}
                  placeholder="Registre a anamnese enquanto examina o paciente..."
                  className="min-h-24 text-sm"
                />
                <Button
                  variant="outline"
                  className="h-11 text-base"
                  onClick={handleSaveAnamnesis}
                  disabled={savingAnamnesis || busy !== null}
                >
                  {savingAnamnesis ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <ClipboardList className="h-5 w-5" />
                  )}
                  Salvar anamnese
                </Button>
              </div>
            )}

            {/* Endereço */}
            <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-sm">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="break-words">{attendance.address}</span>
            </div>

            {/* Dados clínicos para prescrever */}
            {attendance.medications.length > 0 && (
              <div className="text-sm">
                <p className="font-medium">Medicamentos atuais</p>
                <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
                  {attendance.medications.map((medication) => (
                    <li key={medication}>• {medication}</li>
                  ))}
                </ul>
              </div>
            )}
            {attendance.planDiagnosis && (
              <div className="text-sm">
                <p className="font-medium">Plano terapêutico vigente</p>
                <p className="mt-1 text-muted-foreground">
                  {attendance.planDiagnosis}
                  {attendance.planSummary ? ` — ${attendance.planSummary}` : ""}
                </p>
              </div>
            )}

            {/* Prescrição e plano terapêutico */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="h-12 text-base"
                render={
                  <Link href={`/prescricoes/novo?atendimento=${attendance.id}`} />
                }
              >
                <FileText className="h-5 w-5" />
                Prescrever
              </Button>
              <Button
                variant="outline"
                className="h-12 text-base"
                render={
                  <Link
                    href={`/planos-terapeuticos/novo?atendimento=${attendance.id}`}
                  />
                }
              >
                <ClipboardList className="h-5 w-5" />
                Plano terapêutico
              </Button>
            </div>

            {/* Histórico completo do paciente (atendimentos e prescrições) */}
            <Button
              variant="outline"
              className="h-12 w-full text-base"
              render={<Link href={`/pacientes/${attendance.patientId}`} />}
            >
              <History className="h-5 w-5" />
              Histórico do paciente
            </Button>

            {/* Navegação e contato */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                className="h-12 text-base"
                render={
                  <a href={navigateUrl} target="_blank" rel="noopener noreferrer" />
                }
              >
                <Navigation className="h-5 w-5" />
                Navegar
              </Button>
              {wazeUrl ? (
                <Button
                  variant="outline"
                  className="h-12 text-base"
                  render={
                    <a href={wazeUrl} target="_blank" rel="noopener noreferrer" />
                  }
                >
                  <CarFront className="h-5 w-5" />
                  Waze
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="h-12 text-base"
                  render={
                    <a href={navigateUrl} target="_blank" rel="noopener noreferrer" />
                  }
                >
                  <MapPin className="h-5 w-5" />
                  Buscar no mapa
                </Button>
              )}
              {phoneDigits && (
                <>
                  <Button
                    variant="outline"
                    className="h-12 text-base"
                    render={<a href={`tel:${phoneDigits}`} />}
                  >
                    <Phone className="h-5 w-5" />
                    Ligar
                  </Button>
                  <Button
                    variant="outline"
                    className="h-12 text-base"
                    render={
                      <a
                        href={`https://wa.me/${phoneDigits}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      />
                    }
                  >
                    <MessageCircle className="h-5 w-5" />
                    WhatsApp
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function DayCards({ attendances }: { attendances: DayCardData[] }) {
  // Sempre ordenado pelo horário do atendimento (do mais cedo ao mais tarde).
  const sorted = [...attendances].sort(
    (a, b) =>
      new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  )

  // Modo foco: ao iniciar um atendimento (ou quando já existe um em
  // andamento), só o cartão ativo fica visível — os demais atendimentos
  // somem para não confundir o médico durante a consulta.
  const [focusedId, setFocusedId] = useState<string | null>(
    () => sorted.find((attendance) => attendance.status === "EM_ATENDIMENTO")?.id ?? null
  )
  const focusedCard = focusedId
    ? sorted.find((attendance) => attendance.id === focusedId)
    : null
  const visible = focusedCard ? [focusedCard] : sorted

  return (
    <div className="flex flex-col gap-4">
      {focusedCard && (
        <Button
          variant="outline"
          className="h-12 w-full text-base lg:w-80"
          onClick={() => setFocusedId(null)}
        >
          <List className="h-5 w-5" />
          Ver todos os atendimentos
        </Button>
      )}
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {visible.map((attendance) => (
          <DayCard
            key={attendance.id}
            attendance={attendance}
            onStarted={() => setFocusedId(attendance.id)}
            onCompleted={() => setFocusedId(null)}
          />
        ))}
      </div>
    </div>
  )
}
