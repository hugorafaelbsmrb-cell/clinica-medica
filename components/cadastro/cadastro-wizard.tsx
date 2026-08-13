"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { PublicDayPicker } from "@/components/agenda/public-day-picker"
import {
  cadastroPublico,
  type CadastroState,
} from "@/lib/actions/cadastro-publico"
import { validateWhatsAppNumber } from "@/lib/actions/whatsapp-validate"
import {
  agendarPublico,
  getPublicAgenda,
  lookupPatientByCpf,
  type PublicAgendaResult,
} from "@/lib/actions/agendamento-publico"

const CAD_STEPS = ["Seus dados", "Seu contato", "Seu endereço", "Confirmação"]
const AG_STEPS = ["Motivo", "Escolha o dia", "Escolha o horário", "Confirmação"]

const WEEKDAY_LABELS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
]

const MONTH_LABELS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
]

function formatDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return {
    date: `${WEEKDAY_LABELS[d.getDay()]}, ${d.getDate()} de ${
      MONTH_LABELS[d.getMonth()]
    } de ${d.getFullYear()}`,
    time: `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}`,
  }
}

type ExistingPatient = {
  id: string
  name: string
  lgpdConsent: boolean
}

/**
 * Wizard público de cadastro + agendamento em duas fases:
 *  1. Cadastro (pacientes novos): dados → contato → endereço → confirmação;
 *  2. Agendamento (todos): motivo → dia → horário → confirmação.
 * Pacientes já cadastrados informam o CPF no primeiro passo e pulam
 * direto para a fase de agendamento.
 */
export function CadastroWizard() {
  const [phase, setPhase] = useState<
    "cadastro" | "agendamento" | "sem-vagas" | "sucesso"
  >("cadastro")

  // Fase de cadastro
  const [cadStep, setCadStep] = useState(0)
  const [name, setName] = useState("")
  const [cpf, setCpf] = useState("")
  const [birthDate, setBirthDate] = useState("")
  const [phone, setPhone] = useState("")
  const [phoneStatus, setPhoneStatus] = useState<
    "idle" | "checking" | "has" | "no" | "error"
  >("idle")
  const [isValidating, startValidation] = useTransition()
  const [street, setStreet] = useState("")
  const [number, setNumber] = useState("")
  const [neighborhood, setNeighborhood] = useState("")
  const [city, setCity] = useState("")
  const [whatsapp, setWhatsapp] = useState<"sim" | "nao">("nao")
  const [lgpd, setLgpd] = useState(false)
  const [error, setError] = useState("")

  // Reconhecimento pelo CPF
  const [cpfStatus, setCpfStatus] = useState<
    "idle" | "checking" | "notfound"
  >("idle")
  const [existingPatient, setExistingPatient] = useState<ExistingPatient | null>(
    null
  )
  const [patientId, setPatientId] = useState("")

  // Fase de agendamento
  const [agStep, setAgStep] = useState(0)
  const [motivo, setMotivo] = useState("")
  const [agenda, setAgenda] = useState<PublicAgendaResult | null>(null)
  const [loadingAgenda, startLoadingAgenda] = useTransition()
  const [selectedDay, setSelectedDay] = useState("")
  const [selectedDayLabel, setSelectedDayLabel] = useState("")
  const [selectedSlot, setSelectedSlot] = useState("")
  const [lgpdAgend, setLgpdAgend] = useState(false)
  const [agendarError, setAgendarError] = useState("")
  const [agendarPending, startAgendar] = useTransition()
  const [successDate, setSuccessDate] = useState("")

  const [state, cadastroFormAction, pending] = useActionState<
    CadastroState | null,
    FormData
  >(cadastroPublico, null)

  // Cadastro concluído → emenda direto na fase de agendamento
  useEffect(() => {
    if (state && state.success) {
      setPatientId(state.patientId ?? "")
      setPhase("agendamento")
      setAgStep(0)
    }
    if (state && !state.success) {
      setError(state.message)
      toast.error(state.message)
    }
  }, [state])

  // Avança no cadastro; no passo 0, tenta reconhecer pelo CPF
  async function nextCadastro() {
    setError("")
    if (cadStep === 0) {
      if (name.trim().length < 3) {
        setError("Por favor, escreva seu nome completo.")
        return
      }
      const digits = cpf.replace(/\D/g, "")
      if (digits.length > 0) {
        if (digits.length !== 11) {
          setError("Informe um CPF válido com 11 números.")
          return
        }
        if (cpfStatus !== "notfound") {
          setCpfStatus("checking")
          const result = await lookupPatientByCpf(cpf)
          if (result.found && result.patientId) {
            setExistingPatient({
              id: result.patientId,
              name: result.name ?? "",
              lgpdConsent: result.lgpdConsent ?? false,
            })
            setPatientId(result.patientId)
            setPhase("agendamento")
            setAgStep(0)
            return
          }
          setCpfStatus("notfound")
          setError(
            result.message ??
              "Não encontramos um cadastro com este CPF. Continue seu cadastro normalmente."
          )
          return
        }
      }
    }
    if (cadStep === 1 && phone.replace(/\D/g, "").length < 10) {
      setError("Por favor, informe seu telefone com DDD.")
      return
    }
    if (cadStep === 2) {
      if (street.trim().length < 3) {
        setError("Por favor, informe o nome da rua.")
        return
      }
      if (number.trim().length < 1) {
        setError("Por favor, informe o número.")
        return
      }
      if (neighborhood.trim().length < 2) {
        setError("Por favor, informe o bairro.")
        return
      }
      if (city.trim().length < 2) {
        setError("Por favor, informe a cidade.")
        return
      }
    }
    setCadStep((current) => Math.min(current + 1, CAD_STEPS.length - 1))
  }

  function backCadastro() {
    setError("")
    setCadStep((current) => Math.max(current - 1, 0))
  }

  // Verifica na W-API se o número informado está registrado no WhatsApp
  function handleValidatePhone() {
    const digits = phone.replace(/\D/g, "")
    if (digits.length < 10) {
      setError("Por favor, informe seu telefone com DDD antes de verificar.")
      return
    }
    setError("")
    startValidation(async () => {
      setPhoneStatus("checking")
      const result = await validateWhatsAppNumber({ phone: digits })
      if (!result.success) {
        setPhoneStatus("error")
        toast.error(result.message)
        return
      }
      setPhoneStatus(result.exists ? "has" : "no")
    })
  }

  // Fase de agendamento: carrega a agenda ao sair do passo de motivo
  function nextAgendamento() {
    setAgendarError("")
    if (agStep === 0) {
      if (motivo.trim().length < 5) {
        setAgendarError("Conte brevemente o motivo da sua consulta.")
        return
      }
      if (agenda) {
        setAgStep(1)
        return
      }
      startLoadingAgenda(async () => {
        const result = await getPublicAgenda()
        if (!result.available) {
          setPhase("sem-vagas")
          return
        }
        setAgenda(result)
        setAgStep(1)
      })
      return
    }
    setAgStep((current) => Math.min(current + 1, AG_STEPS.length - 1))
  }

  function backAgendamento() {
    setAgendarError("")
    if (agStep === 0) {
      // Paciente existente: volta para o primeiro passo do cadastro
      if (existingPatient) {
        setPhase("cadastro")
        setCadStep(0)
      }
      return
    }
    setAgStep((current) => current - 1)
  }

  function confirmarAgendamento() {
    if (!patientId) {
      setAgendarError("Cadastro não identificado. Refaça o cadastro.")
      return
    }
    if (!selectedSlot) {
      setAgendarError("Escolha um horário antes de confirmar.")
      return
    }
    if (existingPatient && !existingPatient.lgpdConsent && !lgpdAgend) {
      setAgendarError(
        "Para concluir, marque a autorização de uso dos seus dados."
      )
      return
    }

    startAgendar(async () => {
      const result = await agendarPublico({
        patientId,
        scheduledAt: selectedSlot,
        reason: motivo,
        lgpdConsent:
          existingPatient && !existingPatient.lgpdConsent ? lgpdAgend : true,
      })
      if (!result.success) {
        setAgendarError(result.message)
        toast.error(result.message)
        return
      }
      setSuccessDate(result.scheduledAt ?? selectedSlot)
      setPhase("sucesso")
    })
  }

  const currentSteps = phase === "agendamento" ? AG_STEPS : CAD_STEPS
  const currentStep = phase === "agendamento" ? agStep : cadStep
  const displayName = existingPatient?.name || name.trim().split(" ")[0]

  // ── Tela: sem horários disponíveis ──────────────────────────────────────
  if (phase === "sem-vagas") {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-500/10">
            <CalendarDays className="h-12 w-12 text-amber-600" />
          </div>
          <h2 className="text-2xl font-semibold">Tudo certo por aqui!</h2>
          <p className="text-lg text-muted-foreground">
            A clínica ainda não liberou horários para agendamento online. Nossa
            equipe entrará em contato para marcar sua consulta.
          </p>
        </CardContent>
      </Card>
    )
  }

  // ── Tela: consulta agendada com sucesso ─────────────────────────────────
  if (phase === "sucesso") {
    const formatted = formatDateTime(successDate)
    return (
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle2 className="h-12 w-12 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold">Consulta agendada!</h2>
          <div className="w-full rounded-xl border-2 border-border p-4">
            <p className="text-lg font-semibold">{formatted.date}</p>
            <p className="text-2xl font-bold text-primary">{formatted.time}</p>
          </div>
          <p className="text-lg text-muted-foreground">
            {displayName
              ? `${displayName}, enviaremos a confirmação pelo WhatsApp, se você autorizou o contato.`
              : "Enviaremos a confirmação pelo WhatsApp, se você autorizou o contato."}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardContent className="pt-6">
        {/* Indicador de progresso */}
        {phase === "agendamento" && (
          <p className="mb-2 text-center text-sm font-semibold text-primary">
            Agendamento da consulta
          </p>
        )}
        <div className="mb-8 flex items-start justify-between gap-2">
          {currentSteps.map((label, index) => (
            <div
              key={label}
              className="flex flex-1 flex-col items-center gap-2 text-center"
            >
              <div
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full border-2 text-base font-semibold transition-colors",
                  index <= currentStep
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/30 text-muted-foreground"
                )}
              >
                {index < currentStep ? <Check className="h-5 w-5" /> : index + 1}
              </div>
              <span
                className={cn(
                  "text-sm",
                  index === currentStep
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {label}
              </span>
            </div>
          ))}
        </div>

        {phase === "cadastro" && (
          <form action={cadastroFormAction} className="flex flex-col gap-6">
            {/* Campos ocultos sempre montados: os inputs visíveis são
                controlados por estado e mudam de passo a passo */}
            <input type="hidden" name="name" value={name} />
            <input type="hidden" name="birthDate" value={birthDate} />
            <input type="hidden" name="cpf" value={cpf} />
            <input type="hidden" name="phone" value={phone} />
            <input type="hidden" name="street" value={street} />
            <input type="hidden" name="number" value={number} />
            <input type="hidden" name="neighborhood" value={neighborhood} />
            <input type="hidden" name="city" value={city} />
            <input type="hidden" name="whatsappEnabled" value={whatsapp} />

            {cadStep === 0 && (
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="mb-1 text-xl font-semibold">
                    Como você se chama?
                  </h2>
                  <p className="text-muted-foreground">
                    Escreva seu nome completo.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="cadastro-nome" className="text-lg font-medium">
                    Nome completo *
                  </label>
                  <Input
                    id="cadastro-nome"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ex.: Maria da Silva"
                    className="h-14 text-lg"
                    autoComplete="name"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="cadastro-nascimento"
                    className="text-lg font-medium"
                  >
                    Data de nascimento
                  </label>
                  <Input
                    id="cadastro-nascimento"
                    type="date"
                    value={birthDate}
                    onChange={(event) => setBirthDate(event.target.value)}
                    className="h-14 text-lg"
                  />
                  <p className="text-sm text-muted-foreground">
                    Se não souber, pode deixar em branco.
                  </p>
                </div>
                <div className="flex flex-col gap-2 rounded-xl border-2 border-primary/40 bg-primary/5 p-4">
                  <label htmlFor="cadastro-cpf" className="text-lg font-medium">
                    Já é paciente? Informe seu CPF
                  </label>
                  <Input
                    id="cadastro-cpf"
                    value={cpf}
                    onChange={(event) => {
                      setCpf(event.target.value)
                      setCpfStatus("idle")
                    }}
                    placeholder="000.000.000-00"
                    inputMode="numeric"
                    className="h-14 text-lg"
                    autoComplete="off"
                  />
                  <p className="text-sm text-muted-foreground">
                    Se você já é paciente, informe seu CPF para ir direto ao
                    agendamento da consulta.
                  </p>
                </div>
                {cpfStatus === "checking" && (
                  <p className="flex items-center gap-2 text-base text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Procurando seu cadastro...
                  </p>
                )}
              </div>
            )}

            {cadStep === 1 && (
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="mb-1 text-xl font-semibold">
                    Qual é o seu telefone?
                  </h2>
                  <p className="text-muted-foreground">
                    Usamos o número para confirmar seu cadastro.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="cadastro-telefone"
                    className="text-lg font-medium"
                  >
                    Telefone com DDD *
                  </label>
                  <Input
                    id="cadastro-telefone"
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(event) => {
                      setPhone(event.target.value)
                      setPhoneStatus("idle")
                    }}
                    placeholder="(11) 99999-0000"
                    className="h-14 text-lg"
                    autoComplete="tel"
                  />
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleValidatePhone}
                  disabled={isValidating}
                  className="h-12 w-full text-base"
                >
                  {isValidating ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Verificando...
                    </>
                  ) : (
                    <>
                      <BadgeCheck className="h-5 w-5" />
                      Verificar se tem WhatsApp
                    </>
                  )}
                </Button>

                {phoneStatus === "has" && (
                  <p className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-4 py-3 text-base font-medium text-emerald-600">
                    <CheckCircle2 className="h-5 w-5 shrink-0" />
                    Este número tem WhatsApp
                  </p>
                )}
                {phoneStatus === "no" && (
                  <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-4 py-3 text-base font-medium text-amber-600">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    Este número não tem WhatsApp. Confira se digitou certo.
                  </p>
                )}
                {phoneStatus === "error" && (
                  <p className="rounded-lg bg-destructive/10 px-4 py-3 text-base font-medium text-destructive">
                    Não foi possível verificar agora. Você pode continuar mesmo
                    assim.
                  </p>
                )}
              </div>
            )}

            {cadStep === 2 && (
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="mb-1 text-xl font-semibold">
                    Onde você mora?
                  </h2>
                  <p className="text-muted-foreground">
                    Para podermos atender você também em casa, se precisar.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="cadastro-rua" className="text-lg font-medium">
                    Nome da rua *
                  </label>
                  <Input
                    id="cadastro-rua"
                    value={street}
                    onChange={(event) => setStreet(event.target.value)}
                    placeholder="Ex.: Rua das Flores"
                    className="h-14 text-lg"
                    autoComplete="street-address"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="cadastro-numero"
                    className="text-lg font-medium"
                  >
                    Número *
                  </label>
                  <Input
                    id="cadastro-numero"
                    value={number}
                    onChange={(event) => setNumber(event.target.value)}
                    placeholder="Ex.: 123"
                    className="h-14 text-lg"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="cadastro-bairro"
                    className="text-lg font-medium"
                  >
                    Bairro *
                  </label>
                  <Input
                    id="cadastro-bairro"
                    value={neighborhood}
                    onChange={(event) => setNeighborhood(event.target.value)}
                    placeholder="Ex.: Centro"
                    className="h-14 text-lg"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="cadastro-cidade"
                    className="text-lg font-medium"
                  >
                    Cidade *
                  </label>
                  <Input
                    id="cadastro-cidade"
                    value={city}
                    onChange={(event) => setCity(event.target.value)}
                    placeholder="Ex.: São Paulo"
                    className="h-14 text-lg"
                  />
                </div>
              </div>
            )}

            {cadStep === 3 && (
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="mb-1 text-xl font-semibold">
                    Quer receber acompanhamento pelo WhatsApp?
                  </h2>
                  <p className="text-muted-foreground">
                    Enviamos lembretes e mensagens sobre a sua saúde.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setWhatsapp("sim")}
                    className={cn(
                      "flex h-16 items-center justify-center rounded-xl border-2 text-lg font-semibold transition-colors",
                      whatsapp === "sim"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background hover:bg-muted"
                    )}
                  >
                    Sim
                  </button>
                  <button
                    type="button"
                    onClick={() => setWhatsapp("nao")}
                    className={cn(
                      "flex h-16 items-center justify-center rounded-xl border-2 text-lg font-semibold transition-colors",
                      whatsapp === "nao"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background hover:bg-muted"
                    )}
                  >
                    Não
                  </button>
                </div>
                <label
                  htmlFor="cadastro-lgpd"
                  className="flex items-start gap-3 rounded-xl border-2 border-border p-4"
                >
                  <input
                    id="cadastro-lgpd"
                    type="checkbox"
                    name="lgpdConsent"
                    checked={lgpd}
                    onChange={(event) => setLgpd(event.target.checked)}
                    className="mt-1 h-6 w-6 shrink-0 accent-primary"
                  />
                  <span className="text-base leading-snug">
                    Autorizo a clínica a guardar meus dados e usar meu telefone
                    para falar comigo sobre consultas e minha saúde (LGPD). *
                  </span>
                </label>

                {/* Campo invisível anti-spam: humanos não preenchem */}
                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  className="hidden"
                />
              </div>
            )}

            {error && (
              <p className="rounded-lg bg-destructive/10 px-4 py-3 text-base font-medium text-destructive">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-3">
              {cadStep < CAD_STEPS.length - 1 ? (
                <Button
                  type="button"
                  onClick={nextCadastro}
                  className="h-14 w-full text-lg"
                >
                  Continuar
                  <ChevronRight className="h-5 w-5" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={pending}
                  className="h-14 w-full text-lg"
                >
                  {pending ? "Enviando..." : "Concluir cadastro"}
                </Button>
              )}
              {cadStep > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={backCadastro}
                  disabled={pending}
                  className="h-12 text-base"
                >
                  <ChevronLeft className="h-5 w-5" />
                  Voltar
                </Button>
              )}
            </div>
          </form>
        )}

        {phase === "agendamento" && (
          <div className="flex flex-col gap-6">
            {existingPatient && agStep === 0 && (
              <p className="rounded-lg bg-emerald-500/10 px-4 py-3 text-base font-medium text-emerald-700">
                Encontramos seu cadastro, {existingPatient.name}!
              </p>
            )}

            {agStep === 0 && (
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="mb-1 text-xl font-semibold">
                    Qual o motivo da sua consulta?
                  </h2>
                  <p className="text-muted-foreground">
                    Conte em poucas palavras o que você está sentindo ou
                    precisa.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="agendamento-motivo"
                    className="text-lg font-medium"
                  >
                    Motivo da consulta *
                  </label>
                  <Textarea
                    id="agendamento-motivo"
                    value={motivo}
                    onChange={(event) => setMotivo(event.target.value)}
                    placeholder="Ex.: dor nas costas há uma semana"
                    className="min-h-36 text-lg"
                  />
                </div>
              </div>
            )}

            {agStep === 1 && agenda && (
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="mb-1 text-xl font-semibold">
                    Escolha o dia da consulta
                  </h2>
                  <p className="text-muted-foreground">
                    Os dias estão agrupados por semana. Toque em um dia para
                    ver os horários.
                  </p>
                </div>
                <PublicDayPicker
                  days={agenda.days}
                  onSelect={(day) => {
                    setSelectedDay(day.date)
                    setSelectedDayLabel(day.label)
                    setSelectedSlot("")
                    setAgStep(2)
                  }}
                />
              </div>
            )}

            {agStep === 2 && agenda && (
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="mb-1 text-xl font-semibold">
                    Escolha o horário
                  </h2>
                  <p className="text-muted-foreground capitalize">
                    {selectedDayLabel}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {agenda.days
                    .find((d) => d.date === selectedDay)
                    ?.slots.map((slot) => (
                      <button
                        key={slot.iso}
                        type="button"
                        onClick={() => {
                          setSelectedSlot(slot.iso)
                          setAgStep(3)
                        }}
                        className="flex h-16 items-center justify-center gap-2 rounded-xl border-2 border-border text-lg font-semibold transition-colors hover:border-primary hover:bg-muted"
                      >
                        <Clock className="h-5 w-5 text-muted-foreground" />
                        {slot.time}
                      </button>
                    ))}
                </div>
              </div>
            )}

            {agStep === 3 && (
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="mb-1 text-xl font-semibold">
                    Confirme sua consulta
                  </h2>
                  <p className="text-muted-foreground">
                    Revise os dados antes de confirmar.
                  </p>
                </div>
                <div className="flex flex-col gap-3 rounded-xl border-2 border-border p-4">
                  <div className="flex justify-between gap-4 text-base">
                    <span className="text-muted-foreground">Paciente</span>
                    <span className="text-right font-medium">{displayName}</span>
                  </div>
                  <div className="flex justify-between gap-4 text-base">
                    <span className="text-muted-foreground">Dia</span>
                    <span className="text-right font-medium capitalize">
                      {selectedDayLabel}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4 text-base">
                    <span className="text-muted-foreground">Horário</span>
                    <span className="font-medium">
                      {selectedSlot ? formatDateTime(selectedSlot).time : ""}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4 text-base">
                    <span className="text-muted-foreground">Motivo</span>
                    <span className="max-w-56 text-right font-medium">
                      {motivo}
                    </span>
                  </div>
                </div>

                {existingPatient && !existingPatient.lgpdConsent && (
                  <label
                    htmlFor="agendamento-lgpd"
                    className="flex items-start gap-3 rounded-xl border-2 border-border p-4"
                  >
                    <input
                      id="agendamento-lgpd"
                      type="checkbox"
                      checked={lgpdAgend}
                      onChange={(event) => setLgpdAgend(event.target.checked)}
                      className="mt-1 h-6 w-6 shrink-0 accent-primary"
                    />
                    <span className="text-base leading-snug">
                      Autorizo a clínica a guardar meus dados e usar meu
                      telefone para falar comigo sobre consultas e minha saúde
                      (LGPD). *
                    </span>
                  </label>
                )}

                {agendarError && (
                  <p className="rounded-lg bg-destructive/10 px-4 py-3 text-base font-medium text-destructive">
                    {agendarError}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-col gap-3">
              {agStep < AG_STEPS.length - 1 ? (
                <Button
                  type="button"
                  onClick={nextAgendamento}
                  disabled={loadingAgenda}
                  className="h-14 w-full text-lg"
                >
                  {loadingAgenda ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Buscando horários...
                    </>
                  ) : (
                    <>
                      Continuar
                      <ChevronRight className="h-5 w-5" />
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={confirmarAgendamento}
                  disabled={agendarPending}
                  className="h-14 w-full text-lg"
                >
                  {agendarPending ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Confirmando...
                    </>
                  ) : (
                    "Confirmar consulta"
                  )}
                </Button>
              )}
              {agStep > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={backAgendamento}
                  disabled={agendarPending || loadingAgenda}
                  className="h-12 text-base"
                >
                  <ChevronLeft className="h-5 w-5" />
                  Voltar
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
