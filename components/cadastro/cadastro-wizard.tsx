"use client"

import { useActionState, useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  FlaskConical,
  History,
  Home,
  Loader2,
  LocateFixed,
  QrCode,
  Stethoscope,
  Video,
  Wallet,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { PublicDayPicker } from "@/components/agenda/public-day-picker"
import { RemarcarConsulta } from "@/components/agenda/remarcar-consulta"
import { CancelarConsultaButton } from "@/components/agenda/cancelar-consulta-button"
import {
  cadastroPublico,
  registerCadastroAttempt,
  type CadastroState,
} from "@/lib/actions/cadastro-publico"
import { validateWhatsAppNumber } from "@/lib/actions/whatsapp-validate"
import {
  agendarPublico,
  getConsultasByCpf,
  getPublicAgenda,
  lookupPatientByCpf,
  pagarComCartaoAgendamento,
  reverseGeocodeCoordinates,
  simularPagamentoAgendamento,
  verificarPagamentoAgendamento,
  type AgendarState,
  type ConsultasPublicasResult,
  type PublicAgendaResult,
} from "@/lib/actions/agendamento-publico"
import {
  TELEMEDICINE_CONSENT_LABEL,
  TELEMEDICINE_CONSENT_TERM,
} from "@/lib/teleconsent"

const CAD_STEPS = ["Seus dados", "Seu contato", "Seu endereço", "Confirmação"]
const AG_STEPS = [
  "Motivo",
  "Tipo de consulta",
  "Médico",
  "Escolha o dia",
  "Escolha o horário",
  "Confirmação",
]

const STATUS_LABEL: Record<string, string> = {
  AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
  AGENDADO: "Agendada",
  REALIZADO: "Realizada",
  CANCELADO: "Cancelada",
}

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

/**
 * Máscara progressiva dd/mm/aaaa para a data de nascimento: insere as
 * barras sozinha e limita dia (1-31) e mês (1-12) enquanto o paciente digita.
 * Mais simples para idosos do que o calendário nativo do celular.
 */
function maskBirthDate(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 8)
  let day = d.slice(0, 2)
  if (day.length === 2) {
    const n = Number(day)
    if (n < 1) day = "01"
    if (n > 31) day = "31"
  }
  let month = d.slice(2, 4)
  if (month.length === 2) {
    const n = Number(month)
    if (n < 1) month = "01"
    if (n > 12) month = "12"
  }
  let out = day
  if (d.length > 2) out += `/${month}`
  if (d.length > 4) out += `/${d.slice(4)}`
  return out
}

/** Converte dd/mm/aaaa para aaaa-mm-dd (formato que o servidor espera). */
function toIsoBirthDate(value: string): string {
  const d = value.replace(/\D/g, "")
  if (d.length !== 8) return ""
  return `${d.slice(4)}-${d.slice(2, 4)}-${d.slice(0, 2)}`
}

type ExistingPatient = {
  id: string
  name: string
  lgpdConsent: boolean
}

/**
 * Wizard público de cadastro + agendamento em duas fases:
 *  1. Cadastro (pacientes novos): dados → contato → endereço → confirmação;
 *  2. Agendamento (todos): motivo → tipo de consulta → médico → dia →
 *     horário → confirmação (passos pulados quando há uma única opção).
 * Pacientes já cadastrados informam o CPF no primeiro passo e pulam
 * direto para a fase de agendamento.
 */
export function CadastroWizard() {
  const [phase, setPhase] = useState<
    | "cadastro"
    | "consultas"
    | "agendamento"
    | "sem-vagas"
    | "pagamento"
    | "sucesso"
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
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null)
  const [gpsStatus, setGpsStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle")
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

  // Consultas do paciente reconhecido pelo CPF (próxima + última)
  const [consultas, setConsultas] = useState<ConsultasPublicasResult | null>(
    null
  )
  const [, startLoadingConsultas] = useTransition()

  // Fase de agendamento
  const [agStep, setAgStep] = useState(0)
  const [motivo, setMotivo] = useState("")
  const [tipoConsulta, setTipoConsulta] = useState<
    "" | "PRESENCIAL" | "DOMICILIAR" | "TELECONSULTA"
  >("")
  const [selectedDoctorId, setSelectedDoctorId] = useState("")
  const [agenda, setAgenda] = useState<PublicAgendaResult | null>(null)
  const [loadingAgenda, startLoadingAgenda] = useTransition()
  const [selectedDay, setSelectedDay] = useState("")
  const [selectedDayLabel, setSelectedDayLabel] = useState("")
  const [selectedSlot, setSelectedSlot] = useState("")
  const [lgpdAgend, setLgpdAgend] = useState(false)
  const [agendarError, setAgendarError] = useState("")
  const [agendarPending, startAgendar] = useTransition()
  const [successDate, setSuccessDate] = useState("")
  const [successMessage, setSuccessMessage] = useState("")

  // Pagamento antecipado do agendamento online (DINHEIRO = no atendimento)
  const [metodoPagamento, setMetodoPagamento] = useState<
    "PIX" | "CARTAO" | "APPLE_PAY" | "DINHEIRO"
  >("PIX")
  // Aceite do termo de consentimento da teleconsulta (CFM 2314/2022)
  const [teleconsent, setTeleconsent] = useState(false)
  const [showTeleTerm, setShowTeleTerm] = useState(false)
  const [paymentData, setPaymentData] = useState<
    AgendarState["payment"] | null
  >(null)
  const [paymentDate, setPaymentDate] = useState("")
  const paymentPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cartão de crédito transparente (checkout direto no sistema)
  const [cardHolder, setCardHolder] = useState("")
  const [cardNumber, setCardNumber] = useState("")
  const [cardExpiry, setCardExpiry] = useState("")
  const [cardCvv, setCardCvv] = useState("")
  const [cardPayPending, startCardPayment] = useTransition()

  // Consulta em loop se o pagamento da reserva já caiu (webhook)
  useEffect(() => {
    if (phase !== "pagamento" || !paymentData) return
    paymentPollRef.current = setInterval(() => {
      verificarPagamentoAgendamento({
        attendanceId: paymentData.attendanceId,
        token: paymentData.token,
      }).then((result) => {
        if (result.pago && result.scheduledAt) {
          setSuccessDate(result.scheduledAt)
          setPhase("sucesso")
        } else if (result.expirado) {
          toast.error("O pagamento expirou. Escolha outro horário, por favor.")
          setAgenda(null)
          setAgStep(0)
          setPhase(existingPatient ? "consultas" : "agendamento")
        }
      })
    }, 10000)
    return () => {
      if (paymentPollRef.current) clearInterval(paymentPollRef.current)
    }
  }, [phase, paymentData, existingPatient])

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
            // Carrega as consultas do paciente antes de trocar de tela
            startLoadingConsultas(async () => {
              const consultas = await getConsultasByCpf(cpf)
              setConsultas(consultas)
              setPhase("consultas")
            })
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
    const birthDigits = birthDate.replace(/\D/g, "")
    if (birthDigits.length > 0 && birthDigits.length < 8) {
      setError(
        "Informe a data de nascimento completa (dd/mm/aaaa) ou deixe em branco."
      )
      return
    }
    if (cadStep === 1 && phone.replace(/\D/g, "").length < 10) {
      setError("Por favor, informe seu telefone com DDD.")
      return
    }
    // Passou do telefone: registra a tentativa de cadastro para a
    // automação de lembrete de cadastro incompleto.
    if (cadStep === 1 && phone.replace(/\D/g, "").length >= 10) {
      registerCadastroAttempt({ name, phone }).catch(() => null)
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

  // GPS do navegador: o paciente está em casa ao se cadastrar,
  // então esta é a forma mais precisa de capturar o endereço (home care).
  function handleUseMyLocation() {
    if (!("geolocation" in navigator)) {
      setGpsStatus("error")
      toast.error("Seu navegador não suporta localização.")
      return
    }
    setGpsStatus("loading")
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGps({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        })
        setGpsStatus("done")
        toast.success("Localização capturada!")
        // Preenche os campos de endereço que ainda estiverem vazios com
        // o endereço da localização (geocodificação reversa) — o paciente
        // confere os dados antes de continuar.
        reverseGeocodeCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
          .then((result) => {
            if (!result.success || !result.address) return
            const parts = result.address
            if (!street.trim()) setStreet(parts.street ?? "")
            if (!number.trim()) setNumber(parts.number ?? "")
            if (!neighborhood.trim()) {
              setNeighborhood(parts.neighborhood ?? "")
            }
            if (!city.trim()) setCity(parts.city ?? "")
            toast.success(
              "Endereço preenchido pela sua localização — confira os dados."
            )
          })
          .catch(() => {
            /* sem reverse geocode, o endereço fica para preenchimento manual */
          })
      },
      () => {
        setGpsStatus("error")
        toast.error(
          "Não foi possível capturar sua localização. Você pode continuar sem ela."
        )
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
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

  // Atualiza a lista de consultas após remarcar ou cancelar
  function refreshConsultas() {
    startLoadingConsultas(async () => {
      const result = await getConsultasByCpf(cpf)
      if (result.found) setConsultas(result)
    })
  }

  // Fase de agendamento: carrega a meta (modalidades + médicos) ao sair do
  // motivo e a agenda do médico escolhido ao chegar no passo do dia.
  // Passos com uma única opção são pulados automaticamente.
  function advanceFromStep(from: number, meta: PublicAgendaResult) {
    const modalities = meta.modalities
    const doctors = meta.doctors
    let next = from + 1
    let doctorId = selectedDoctorId
    if (next === 1 && modalities.length === 1) {
      setTipoConsulta(modalities[0].id)
      next = 2
    }
    if (next === 2 && doctors.length <= 1) {
      if (doctors.length === 1) {
        doctorId = doctors[0].id
        setSelectedDoctorId(doctorId)
      }
      next = 3
    }
    if (next === 3) {
      if (doctors.length > 0 && !doctorId) {
        setAgendarError("Escolha o médico da consulta.")
        return
      }
      setSelectedDay("")
      setSelectedDayLabel("")
      setSelectedSlot("")
      startLoadingAgenda(async () => {
        const result = await getPublicAgenda(
          doctorId || undefined,
          patientId || undefined
        )
        if (!result.available) {
          setPhase("sem-vagas")
          return
        }
        setAgenda(result)
        setAgStep(3)
      })
      return
    }
    setAgStep(next)
  }

  function nextAgendamento() {
    setAgendarError("")
    if (agStep === 0) {
      if (motivo.trim().length < 5) {
        setAgendarError("Conte brevemente o motivo da sua consulta.")
        return
      }
      if (agenda) {
        advanceFromStep(0, agenda)
        return
      }
      startLoadingAgenda(async () => {
        const result = await getPublicAgenda(undefined, patientId || undefined)
        if (result.modalities.length === 0) {
          setPhase("sem-vagas")
          return
        }
        setAgenda(result)
        advanceFromStep(0, result)
      })
      return
    }
    if (agenda) {
      advanceFromStep(agStep, agenda)
    } else {
      setAgStep((current) => Math.min(current + 1, AG_STEPS.length - 1))
    }
  }

  function backAgendamento() {
    setAgendarError("")
    if (agStep === 0) {
      // Paciente existente: volta para a tela de consultas dele
      if (existingPatient) {
        setPhase("consultas")
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
    if (!tipoConsulta) {
      setAgendarError("Escolha o tipo de consulta antes de confirmar.")
      return
    }
    if (!selectedDoctorId && (agenda?.doctors.length ?? 0) > 0) {
      setAgendarError("Escolha o médico antes de confirmar.")
      return
    }
    if (existingPatient && !existingPatient.lgpdConsent && !lgpdAgend) {
      setAgendarError(
        "Para concluir, marque a autorização de uso dos seus dados."
      )
      return
    }
    if (tipoConsulta === "TELECONSULTA" && !teleconsent) {
      setAgendarError(
        "Para teleconsulta, é necessário aceitar o termo de consentimento."
      )
      return
    }
    if (tipoConsultaPreco > 0 && metodosDisponiveis.length === 0) {
      setAgendarError(
        "Nenhuma forma de pagamento disponível para esta consulta. Fale com a clínica, por favor."
      )
      return
    }

    startAgendar(async () => {
      const result = await agendarPublico({
        patientId,
        scheduledAt: selectedSlot,
        reason: motivo,
        method: metodoPagamento,
        type: tipoConsulta || "PRESENCIAL",
        doctorId: selectedDoctorId || undefined,
        lgpdConsent:
          existingPatient && !existingPatient.lgpdConsent ? lgpdAgend : true,
        teleconsent: tipoConsulta === "TELECONSULTA" ? teleconsent : true,
      })
      if (!result.success) {
        setAgendarError(result.message)
        toast.error(result.message)
        return
      }
      setSuccessDate(result.scheduledAt ?? selectedSlot)
      if (result.payment) {
        // Horário reservado: segue para o pagamento antes de confirmar
        setPaymentData(result.payment)
        setPaymentDate(result.scheduledAt ?? selectedSlot)
        setPhase("pagamento")
        return
      }
      // Sem cobrança antecipada (ex.: dinheiro no atendimento), a mensagem
      // do servidor orienta o pagamento no ato — exibida na tela de sucesso.
      setSuccessMessage(result.message)
      setPhase("sucesso")
    })
  }

  // Verificação manual do pagamento da reserva
  function verificarPagamentoAgora() {
    if (!paymentData) return
    startAgendar(async () => {
      const result = await verificarPagamentoAgendamento({
        attendanceId: paymentData.attendanceId,
        token: paymentData.token,
      })
      if (result.pago && result.scheduledAt) {
        setSuccessDate(result.scheduledAt)
        setPhase("sucesso")
      } else if (result.expirado) {
        toast.error("O pagamento expirou. Escolha outro horário, por favor.")
        setAgenda(null)
        setAgStep(0)
        setPhase(existingPatient ? "consultas" : "agendamento")
      } else {
        toast.info("Ainda não confirmamos o pagamento. Tente de novo em instantes.")
      }
    })
  }

  // Simula a aprovação de uma cobrança em modo teste (gateway sem chave)
  function simularPagamento() {
    if (!paymentData) return
    startAgendar(async () => {
      const result = await simularPagamentoAgendamento({
        attendanceId: paymentData.attendanceId,
        token: paymentData.token,
      })
      if (result.success) {
        setSuccessDate(result.scheduledAt ?? paymentDate)
        setPhase("sucesso")
      } else {
        toast.error(result.message)
      }
    })
  }

  /** Máscara 0000 0000 0000 0000 para o número do cartão. */
  function maskCardNumber(value: string): string {
    const digits = value.replace(/\D/g, "").slice(0, 16)
    return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim()
  }

  /** Máscara MM/AA para a validade do cartão (limita o mês em 01–12). */
  function maskCardExpiry(value: string): string {
    const digits = value.replace(/\D/g, "").slice(0, 4)
    let month = digits.slice(0, 2)
    if (month.length === 2) {
      const n = Number(month)
      if (n < 1) month = "01"
      if (n > 12) month = "12"
    }
    return month + (digits.length > 2 ? `/${digits.slice(2)}` : "")
  }

  // Paga a reserva com cartão direto no sistema (sem sair da página)
  function pagarComCartao() {
    if (!paymentData) return
    const digits = cardNumber.replace(/\D/g, "")
    if (digits.length < 13 || digits.length > 19) {
      toast.error("Informe o número completo do cartão.")
      return
    }
    const expiryDigits = cardExpiry.replace(/\D/g, "")
    if (expiryDigits.length !== 4) {
      toast.error("Informe a validade do cartão (MM/AA).")
      return
    }
    if (cardHolder.trim().length < 3) {
      toast.error("Informe o nome impresso no cartão.")
      return
    }
    if (!/^\d{3,4}$/.test(cardCvv)) {
      toast.error("Informe o código de segurança (CVV).")
      return
    }
    startCardPayment(async () => {
      const result = await pagarComCartaoAgendamento({
        attendanceId: paymentData.attendanceId,
        token: paymentData.token,
        holderName: cardHolder.trim(),
        number: digits,
        expiryMonth: expiryDigits.slice(0, 2),
        expiryYear: `20${expiryDigits.slice(2)}`,
        ccv: cardCvv,
      })
      if (result.success && result.scheduledAt) {
        setSuccessDate(result.scheduledAt)
        setPhase("sucesso")
      } else if (result.pending) {
        toast.info(result.message)
      } else {
        toast.error(result.message)
      }
    })
  }

  // Copia para a área de transferência (com fallback para navegadores antigos)
  async function copiarPagamento(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const textarea = document.createElement("textarea")
      textarea.value = text
      textarea.style.position = "fixed"
      textarea.style.opacity = "0"
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand("copy")
      document.body.removeChild(textarea)
    }
    toast.success("Copiado!")
  }

  const currentSteps = phase === "agendamento" ? AG_STEPS : CAD_STEPS
  const currentStep = phase === "agendamento" ? agStep : cadStep
  const displayName = existingPatient?.name || name.trim().split(" ")[0]
  const tipoConsultaInfo = agenda?.modalities.find((m) => m.id === tipoConsulta)
  const tipoConsultaLabel = tipoConsultaInfo?.label ?? ""
  const tipoConsultaPreco = tipoConsultaInfo?.price ?? 0
  const medicoNome =
    agenda?.doctors.find((d) => d.id === selectedDoctorId)?.name ?? ""

  // Meios de pagamento liberados para o cliente (admin + gateways).
  // Dinheiro só vale para presencial/domiciliar (pago no atendimento).
  const metodosDisponiveis: ("PIX" | "CARTAO" | "APPLE_PAY" | "DINHEIRO")[] =
    []
  if (agenda?.paymentMethods.pix) metodosDisponiveis.push("PIX")
  if (agenda?.paymentMethods.cartao) metodosDisponiveis.push("CARTAO")
  if (agenda?.paymentMethods.applePay) metodosDisponiveis.push("APPLE_PAY")
  if (agenda?.paymentMethods.dinheiro && tipoConsulta !== "TELECONSULTA") {
    metodosDisponiveis.push("DINHEIRO")
  }

  // Se o meio selecionado foi desativado pelo admin (ou a modalidade
  // mudou), volta automaticamente para o primeiro disponível.
  useEffect(() => {
    if (metodosDisponiveis.length === 0) return
    if (!metodosDisponiveis.includes(metodoPagamento)) {
      setMetodoPagamento(metodosDisponiveis[0])
    }
  }, [metodosDisponiveis, metodoPagamento])

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
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setCpfStatus("idle")
              setPhase(existingPatient ? "consultas" : "cadastro")
            }}
            className="h-12 text-base"
          >
            <ChevronLeft className="h-5 w-5" />
            Voltar
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ── Tela: pagamento pendente da reserva ──────────────────────────────
  if (phase === "pagamento" && paymentData) {
    const formatted = formatDateTime(paymentDate)
    const valor = paymentData.amount.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
    })
    return (
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col gap-5 py-10">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-500/10">
              <Clock className="h-12 w-12 text-amber-600" />
            </div>
            <h2 className="text-2xl font-semibold">Horário reservado!</h2>
            <p className="text-lg text-muted-foreground">
              Falta o pagamento para confirmar a consulta.
            </p>
          </div>

          <div className="w-full rounded-xl border-2 border-amber-500 bg-amber-500/10 p-4 text-center">
            <p className="text-lg font-semibold capitalize">{formatted.date}</p>
            <p className="text-2xl font-bold text-amber-700">{formatted.time}</p>
            <p className="mt-1 text-base font-medium">Valor: R$ {valor}</p>
            {paymentData.pricingZone === "FORA" && (
              <p className="mt-1 text-xs text-muted-foreground">
                Inclui o deslocamento fora do raio urbano.
              </p>
            )}
          </div>

          {paymentData.mock ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-4 text-center">
                <p className="text-sm font-medium text-primary">
                  Modo teste: o pagamento está simulado até a clínica ativar o
                  gateway (Asaas/Stripe).
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Nenhum valor real é cobrado nesta etapa.
                </p>
              </div>
              <Button
                type="button"
                className="h-14 w-full text-lg"
                onClick={simularPagamento}
                disabled={agendarPending}
              >
                {agendarPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <FlaskConical className="h-5 w-5" />
                )}
                Simular pagamento aprovado
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Ao simular, a consulta é confirmada e você recebe a confirmação
                pelo WhatsApp.
              </p>
            </div>
          ) : (
            <>
              {paymentData.method === "PIX" && paymentData.pixQrCodeUrl && (
                <div className="flex flex-col items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={paymentData.pixQrCodeUrl}
                    alt="QR Code PIX"
                    className="h-56 w-56 rounded-xl border-2 border-border bg-white p-2"
                  />
                  {paymentData.pixCopiaCola && (
                    <div className="flex w-full flex-col gap-2">
                      <p className="break-all rounded-lg border bg-muted/40 p-2 text-xs text-muted-foreground">
                        {paymentData.pixCopiaCola}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => copiarPagamento(paymentData.pixCopiaCola ?? "")}
                        className="h-12 text-base"
                      >
                        <Copy className="h-5 w-5" />
                        Copiar código PIX
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {paymentData.method === "CARTAO" && (
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault()
                    pagarComCartao()
                  }}
                >
                  <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-3 text-center">
                    <p className="text-sm font-medium">
                      Pague com cartão de crédito direto aqui — sem sair desta
                      página.
                    </p>
                  </div>
                  <Input
                    placeholder="Nome impresso no cartão"
                    value={cardHolder}
                    onChange={(e) => setCardHolder(e.target.value)}
                    autoComplete="cc-name"
                    className="h-12"
                  />
                  <Input
                    placeholder="Número do cartão"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(maskCardNumber(e.target.value))}
                    inputMode="numeric"
                    autoComplete="cc-number"
                    className="h-12"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      placeholder="Validade (MM/AA)"
                      value={cardExpiry}
                      onChange={(e) => setCardExpiry(maskCardExpiry(e.target.value))}
                      inputMode="numeric"
                      autoComplete="cc-exp"
                      className="h-12"
                    />
                    <Input
                      placeholder="CVV"
                      value={cardCvv}
                      onChange={(e) =>
                        setCardCvv(e.target.value.replace(/\D/g, "").slice(0, 4))
                      }
                      inputMode="numeric"
                      autoComplete="cc-csc"
                      className="h-12"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="h-14 w-full text-lg"
                    disabled={cardPayPending || agendarPending}
                  >
                    {cardPayPending ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <CreditCard className="h-5 w-5" />
                    )}
                    Pagar R$ {valor} com cartão
                  </Button>
                </form>
              )}

              {paymentData.method === "APPLE_PAY" && paymentData.checkoutUrl && (
                <Button
                  type="button"
                  className="h-14 w-full text-lg"
                  render={
                    <a
                      href={paymentData.checkoutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  <CreditCard className="h-5 w-5" />
                  Pagar com Apple Pay
                </Button>
              )}

              <Button
                type="button"
                variant="secondary"
                onClick={verificarPagamentoAgora}
                disabled={agendarPending}
                className="h-12 text-base"
              >
                {agendarPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <BadgeCheck className="h-5 w-5" />
                )}
                Já paguei — verificar
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                Assim que o pagamento for confirmado, sua consulta é confirmada
                automaticamente e você recebe a confirmação pelo WhatsApp.
              </p>
            </>
          )}
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
          {successMessage && successMessage !== "Consulta agendada!" && (
            <p className="text-base font-medium text-amber-700 dark:text-amber-400">
              {successMessage}
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  // ── Tela: consultas do paciente reconhecido pelo CPF ─────────────────
  if (phase === "consultas") {
    const next = consultas?.next ?? null
    const last = consultas?.last ?? null
    return (
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col gap-5 py-6">
          <div className="text-center">
            <p className="text-lg font-semibold text-primary">
              Olá, {existingPatient?.name}!
            </p>
            <h2 className="text-2xl font-semibold">Suas consultas</h2>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <CalendarCheck2 className="h-5 w-5 text-primary" />
                Próxima consulta
              </h3>
              {next && (
                <Badge variant="secondary">
                  {STATUS_LABEL[next.status] ?? next.status}
                </Badge>
              )}
            </div>
            {next ? (
              <>
                <div className="rounded-xl border-2 border-emerald-500 bg-emerald-500/10 p-4 text-center shadow-sm">
                  <p className="text-lg font-semibold capitalize">
                    {formatDateTime(next.scheduledAt).date}
                  </p>
                  <p className="text-3xl font-bold text-emerald-600">
                    {formatDateTime(next.scheduledAt).time}
                  </p>
                  {next.slotNote && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Motivo: {next.slotNote}
                    </p>
                  )}
                </div>
                <RemarcarConsulta
                  token={next.cancelToken}
                  onDone={refreshConsultas}
                />
                <CancelarConsultaButton
                  token={next.cancelToken}
                  onDone={refreshConsultas}
                />
              </>
            ) : (
              <p className="rounded-xl border-2 border-border p-4 text-center text-muted-foreground">
                Você não tem consultas agendadas no momento.
              </p>
            )}
          </div>

          {last && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <History className="h-5 w-5 text-muted-foreground" />
                  Última consulta
                </h3>
                <Badge
                  variant="outline"
                  className={
                    last.status === "REALIZADO"
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
                      : undefined
                  }
                >
                  {STATUS_LABEL[last.status] ?? last.status}
                </Badge>
              </div>
              <div className="rounded-xl border-2 border-border p-4">
                <p className="text-base font-semibold capitalize">
                  {formatDateTime(last.scheduledAt).date}
                </p>
                <p className="text-xl font-bold text-primary">
                  {formatDateTime(last.scheduledAt).time}
                </p>
                {last.slotNote && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Motivo: {last.slotNote}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <Button
              type="button"
              onClick={() => {
                setMotivo("")
                setAgenda(null)
                setAgStep(0)
                setPhase("agendamento")
              }}
              className="h-14 w-full text-lg"
            >
              <CalendarClock className="h-5 w-5" />
              Agendar nova consulta
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCpfStatus("idle")
                setPhase("cadastro")
                setCadStep(0)
              }}
              className="h-12 text-base"
            >
              <ChevronLeft className="h-5 w-5" />
              Voltar
            </Button>
          </div>
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
            <input type="hidden" name="birthDate" value={toIsoBirthDate(birthDate)} />
            <input type="hidden" name="cpf" value={cpf} />
            <input type="hidden" name="phone" value={phone} />
            <input type="hidden" name="street" value={street} />
            <input type="hidden" name="number" value={number} />
            <input type="hidden" name="neighborhood" value={neighborhood} />
            <input type="hidden" name="city" value={city} />
            <input type="hidden" name="latitude" value={gps ? String(gps.lat) : ""} />
            <input
              type="hidden"
              name="longitude"
              value={gps ? String(gps.lng) : ""}
            />
            <input type="hidden" name="locationSource" value={gps ? "GPS" : ""} />
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
                    type="text"
                    inputMode="numeric"
                    value={birthDate}
                    onChange={(event) =>
                      setBirthDate(maskBirthDate(event.target.value))
                    }
                    placeholder="Ex.: 25/12/1960"
                    maxLength={10}
                    autoComplete="bday"
                    className="h-14 text-lg"
                  />
                  <p className="text-sm text-muted-foreground">
                    Digite só os números — as barras entram sozinhas. Se não
                    souber, pode deixar em branco.
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
                    Use sua localização atual — é o jeito mais rápido e o
                    médico navega direto até sua casa. Ou digite o endereço
                    abaixo.
                  </p>
                </div>
                {/* GPS como forma padrão: o paciente está em casa agora */}
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    onClick={handleUseMyLocation}
                    disabled={gpsStatus === "loading"}
                    className="h-12 w-full text-base"
                  >
                    {gpsStatus === "loading" ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Capturando...
                      </>
                    ) : (
                      <>
                        <LocateFixed className="h-5 w-5" />
                        Usar minha localização
                      </>
                    )}
                  </Button>
                  {gpsStatus === "done" && (
                    <p className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-4 py-3 text-base font-medium text-emerald-600">
                      <CheckCircle2 className="h-5 w-5 shrink-0" />
                      Localização salva — o médico poderá navegar até sua casa.
                    </p>
                  )}
                  {gpsStatus === "error" && (
                    <p className="rounded-lg bg-amber-500/10 px-4 py-3 text-base font-medium text-amber-600">
                      Não foi possível capturar a localização. O endereço
                      digitado já basta.
                    </p>
                  )}
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
                    Como você quer ser atendido?
                  </h2>
                  <p className="text-muted-foreground">
                    Escolha o tipo de consulta.
                  </p>
                </div>
                <div className="flex flex-col gap-3">
                  {agenda.modalities.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setTipoConsulta(m.id)}
                      className={cn(
                        "flex items-center gap-4 rounded-xl border-2 p-4 text-left transition-colors",
                        tipoConsulta === m.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted"
                      )}
                    >
                      {m.id === "PRESENCIAL" ? (
                        <Stethoscope className="h-8 w-8 shrink-0 text-primary" />
                      ) : m.id === "DOMICILIAR" ? (
                        <Home className="h-8 w-8 shrink-0 text-primary" />
                      ) : (
                        <Video className="h-8 w-8 shrink-0 text-primary" />
                      )}
                      <div className="flex flex-col gap-0.5">
                        <p className="text-lg font-semibold">{m.label}</p>
                        <p className="text-sm text-muted-foreground">
                          {m.id === "PRESENCIAL"
                            ? "Atendimento presencial com o médico."
                            : m.id === "DOMICILIAR"
                              ? "O médico vai até a sua casa."
                              : "Consulta por videochamada, sem sair de casa."}
                        </p>
                        {m.price > 0 && (
                          <p className="text-base font-medium">
                            R${" "}
                            {m.price.toLocaleString("pt-BR", {
                              minimumFractionDigits: 2,
                            })}
                            {m.zone === "FORA" && (
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                (fora do raio urbano)
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {agStep === 2 && agenda && (
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="mb-1 text-xl font-semibold">
                    Escolha o médico
                  </h2>
                  <p className="text-muted-foreground">
                    Com qual médico você quer se consultar?
                  </p>
                </div>
                <div className="flex flex-col gap-3">
                  {agenda.doctors.map((doctor) => (
                    <button
                      key={doctor.id}
                      type="button"
                      onClick={() => {
                        setSelectedDoctorId(doctor.id)
                        setSelectedDay("")
                        setSelectedDayLabel("")
                        setSelectedSlot("")
                      }}
                      className={cn(
                        "flex items-center gap-4 rounded-xl border-2 p-4 text-left transition-colors",
                        selectedDoctorId === doctor.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted"
                      )}
                    >
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
                        {doctor.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <p className="text-lg font-semibold">{doctor.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {doctor.crm
                            ? `CRM ${doctor.crm}`
                            : "CRM não informado"}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {agStep === 3 && agenda && (
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
                    setAgStep(4)
                  }}
                />
              </div>
            )}

            {agStep === 4 && agenda && (
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
                          setAgStep(5)
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

            {agStep === 5 && (
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
                    <span className="text-muted-foreground">
                      Tipo de consulta
                    </span>
                    <span className="text-right font-medium">
                      {tipoConsultaLabel}
                    </span>
                  </div>
                  {medicoNome && (
                    <div className="flex justify-between gap-4 text-base">
                      <span className="text-muted-foreground">Médico</span>
                      <span className="text-right font-medium">{medicoNome}</span>
                    </div>
                  )}
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
                  {tipoConsultaPreco > 0 && (
                    <div className="flex justify-between gap-4 border-t border-border pt-3 text-base">
                      <span className="text-muted-foreground">Valor</span>
                      <span className="font-medium">
                        R${tipoConsultaPreco.toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  )}
                </div>

                {tipoConsultaPreco > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-base font-medium">Como prefere pagar?</p>
                    <div className="grid grid-cols-2 gap-3">
                      {agenda?.paymentMethods.pix && (
                        <button
                          type="button"
                          onClick={() => setMetodoPagamento("PIX")}
                          className={cn(
                            "flex h-16 items-center justify-center gap-2 rounded-xl border-2 text-lg font-semibold transition-colors",
                            metodoPagamento === "PIX"
                              ? "border-primary bg-primary/5 text-primary"
                              : "border-border hover:bg-muted"
                          )}
                        >
                          <QrCode className="h-5 w-5" />
                          PIX
                        </button>
                      )}
                      {agenda?.paymentMethods.cartao && (
                        <button
                          type="button"
                          onClick={() => setMetodoPagamento("CARTAO")}
                          className={cn(
                            "flex h-16 items-center justify-center gap-2 rounded-xl border-2 text-lg font-semibold transition-colors",
                            metodoPagamento === "CARTAO"
                              ? "border-primary bg-primary/5 text-primary"
                              : "border-border hover:bg-muted"
                          )}
                        >
                          <CreditCard className="h-5 w-5" />
                          Cartão
                        </button>
                      )}
                      {/* Dinheiro: só para consultas no local (presencial/domiciliar),
                          o pagamento acontece no momento do atendimento. */}
                      {tipoConsulta !== "TELECONSULTA" &&
                        agenda?.paymentMethods.dinheiro && (
                          <button
                            type="button"
                            onClick={() => setMetodoPagamento("DINHEIRO")}
                            className={cn(
                              "flex h-16 items-center justify-center gap-2 rounded-xl border-2 text-lg font-semibold transition-colors",
                              metodoPagamento === "DINHEIRO"
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-border hover:bg-muted"
                            )}
                          >
                            <Banknote className="h-5 w-5" />
                            Dinheiro
                          </button>
                        )}
                      {/* Apple Pay só com o Stripe configurado e liberado
                          pelo admin — sem chave a opção fica oculta. */}
                      {agenda?.paymentMethods.applePay && (
                        <button
                          type="button"
                          onClick={() => setMetodoPagamento("APPLE_PAY")}
                          className={cn(
                            "col-span-2 flex h-16 items-center justify-center gap-2 rounded-xl border-2 text-lg font-semibold transition-colors",
                            metodoPagamento === "APPLE_PAY"
                              ? "border-primary bg-primary/5 text-primary"
                              : "border-border hover:bg-muted"
                          )}
                        >
                          <Wallet className="h-5 w-5" />
                          Apple Pay
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {metodoPagamento === "PIX"
                        ? "Você verá o QR code na próxima tela."
                        : metodoPagamento === "APPLE_PAY"
                          ? "Disponível em aparelhos Apple com cartão na carteira."
                          : metodoPagamento === "DINHEIRO"
                            ? "Você pagará em dinheiro para o médico no momento da consulta."
                            : "Você será direcionado para pagar com seu cartão."}
                    </p>
                  </div>
                )}

                {tipoConsulta === "TELECONSULTA" && (
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="agendamento-teleconsent"
                      className="flex items-start gap-3 rounded-xl border-2 border-border p-4"
                    >
                      <input
                        id="agendamento-teleconsent"
                        type="checkbox"
                        checked={teleconsent}
                        onChange={(event) => setTeleconsent(event.target.checked)}
                        className="mt-1 h-6 w-6 shrink-0 accent-primary"
                      />
                      <span className="text-base leading-snug">
                        {TELEMEDICINE_CONSENT_LABEL}
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowTeleTerm((value) => !value)}
                      className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {showTeleTerm ? "Ocultar termo" : "Ler termo completo"}
                    </button>
                    {showTeleTerm && (
                      <p className="max-h-56 overflow-y-auto whitespace-pre-line rounded-lg bg-muted/60 p-3 text-sm leading-relaxed text-muted-foreground">
                        {TELEMEDICINE_CONSENT_TERM}
                      </p>
                    )}
                  </div>
                )}

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
                  ) : tipoConsultaPreco > 0 &&
                    metodoPagamento !== "DINHEIRO" ? (
                    "Reservar horário e pagar"
                  ) : (
                    "Confirmar consulta"
                  )}
                </Button>
              )}
              {(agStep > 0 || existingPatient) && (
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
