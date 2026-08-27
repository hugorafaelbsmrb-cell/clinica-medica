"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  BadgeCheck,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  FlaskConical,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import {
  pagarComCartao,
  simularPagamentoPorToken,
  trocarMetodoPagamentoPorToken,
  verificarPagamentoPorToken,
} from "@/lib/actions/pagamento-publico"

export type PagamentoPublicoData = {
  /** Id da cobrança (chave pública da página). */
  token: string
  method: "PIX" | "CARTAO" | "APPLE_PAY"
  amount: number
  status: string
  /** true = cobrança em modo teste (gateway sem chave configurada). */
  mock: boolean
  pixQrCodeUrl: string | null
  pixCopiaCola: string | null
  checkoutUrl: string | null
  scheduledAt: string | null
  patientName: string | null
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

const METODO_LABEL: Record<string, string> = {
  PIX: "PIX (QR code)",
  CARTAO: "Cartão de crédito",
  APPLE_PAY: "Apple Pay",
}

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

/**
 * Página de pagamento pública (sem login): o paciente paga a cobrança
 * direto aqui — PIX com QR code + copia-e-cola e cartão de crédito
 * processado de forma transparente — sem ir para o site do gateway.
 */
export function PagamentoPublicoForm({ data }: { data: PagamentoPublicoData }) {
  const finished = data.status === "PAGO"
  const expired =
    data.status === "EXPIRADO" ||
    data.status === "CANCELADO" ||
    data.status === "FALHOU"

  const [phase, setPhase] = useState<"pendente" | "sucesso" | "expirado">(
    finished ? "sucesso" : expired ? "expirado" : "pendente"
  )
  const [scheduledAt, setScheduledAt] = useState(data.scheduledAt ?? "")

  // Cartão de crédito transparente
  const [cardHolder, setCardHolder] = useState("")
  const [cardHolderEmail, setCardHolderEmail] = useState("")
  const [cardNumber, setCardNumber] = useState("")
  const [cardExpiry, setCardExpiry] = useState("")
  const [cardCvv, setCardCvv] = useState("")
  // Seletor de troca de forma de pagamento
  const [showTrocarMetodo, setShowTrocarMetodo] = useState(false)
  const [pending, startPending] = useTransition()
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Consulta em loop se o pagamento já caiu (webhook)
  useEffect(() => {
    if (phase !== "pendente") return
    pollRef.current = setInterval(() => {
      verificarPagamentoPorToken({ token: data.token }).then((result) => {
        if (result.pago && result.scheduledAt) {
          setScheduledAt(result.scheduledAt)
          setPhase("sucesso")
        } else if (result.expirado) {
          setPhase("expirado")
        }
      })
    }, 10000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [phase, data.token])

  function verificarAgora() {
    startPending(async () => {
      const result = await verificarPagamentoPorToken({ token: data.token })
      if (result.pago && result.scheduledAt) {
        setScheduledAt(result.scheduledAt)
        setPhase("sucesso")
      } else if (result.expirado) {
        setPhase("expirado")
      } else {
        toast.info(
          "Ainda não confirmamos o pagamento. Tente de novo em instantes."
        )
      }
    })
  }

  function pagarCartao() {
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
    // O Asaas exige o e-mail do titular para processar o cartão.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cardHolderEmail.trim())) {
      toast.error("Informe o e-mail do titular do cartão.")
      return
    }
    if (!/^\d{3,4}$/.test(cardCvv)) {
      toast.error("Informe o código de segurança (CVV).")
      return
    }
    startPending(async () => {
      const result = await pagarComCartao({
        token: data.token,
        holderName: cardHolder.trim(),
        holderEmail: cardHolderEmail.trim(),
        number: digits,
        expiryMonth: expiryDigits.slice(0, 2),
        expiryYear: `20${expiryDigits.slice(2)}`,
        ccv: cardCvv,
      })
      if (result.success && result.scheduledAt) {
        setScheduledAt(result.scheduledAt)
        setPhase("sucesso")
      } else if (result.pending) {
        toast.info(result.message)
      } else {
        toast.error(result.message)
      }
    })
  }

  // Simula a aprovação de uma cobrança em modo teste (gateway sem chave)
  function simular() {
    startPending(async () => {
      const result = await simularPagamentoPorToken({ token: data.token })
      if (result.success) {
        if (result.scheduledAt) setScheduledAt(result.scheduledAt)
        setPhase("sucesso")
      } else {
        toast.error(result.message)
      }
    })
  }

  // Troca a forma de pagamento: a página recarrega com a nova cobrança
  function trocarMetodo(method: "PIX" | "CARTAO" | "APPLE_PAY") {
    startPending(async () => {
      const result = await trocarMetodoPagamentoPorToken({
        token: data.token,
        method,
      })
      if (result.success && result.newToken) {
        window.location.href = `/pagar/${result.newToken}`
        return
      }
      toast.error(result.message)
    })
  }

  // Copia para a área de transferência (com fallback para navegadores antigos)
  async function copiar(text: string) {
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

  const valor = data.amount.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
  })

  if (phase === "sucesso") {
    const formatted = scheduledAt ? formatDateTime(scheduledAt) : null
    return (
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle2 className="h-12 w-12 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold">Pagamento confirmado!</h2>
          {formatted && (
            <div className="w-full rounded-xl border-2 border-border p-4">
              <p className="text-lg font-semibold">{formatted.date}</p>
              <p className="text-2xl font-bold text-primary">{formatted.time}</p>
            </div>
          )}
          <p className="text-lg text-muted-foreground">
            Recebemos a confirmação do pagamento. Obrigado!
          </p>
        </CardContent>
      </Card>
    )
  }

  if (phase === "expirado") {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-500/10">
            <XCircle className="h-12 w-12 text-amber-600" />
          </div>
          <h2 className="text-2xl font-semibold">Pagamento expirado</h2>
          <p className="text-lg text-muted-foreground">
            Esta cobrança não está mais disponível. Se precisar, fale com a
            clínica para gerar um novo pagamento.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardContent className="flex flex-col gap-5 py-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-500/10">
            <Clock className="h-12 w-12 text-amber-600" />
          </div>
          <h2 className="text-2xl font-semibold">Pagamento</h2>
          <p className="text-lg text-muted-foreground">
            {data.patientName
              ? `Olá, ${data.patientName.split(" ")[0]}! Falta o pagamento para concluir.`
              : "Falta o pagamento para concluir."}
          </p>
        </div>

        <div className="w-full rounded-xl border-2 border-amber-500 bg-amber-500/10 p-4 text-center">
          <p className="text-2xl font-bold text-amber-700">R$ {valor}</p>
          {data.scheduledAt && (
            <p className="mt-1 text-base font-medium capitalize">
              {formatDateTime(data.scheduledAt).date} ·{" "}
              {formatDateTime(data.scheduledAt).time}
            </p>
          )}
        </div>

        {data.mock ? (
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
              onClick={simular}
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <FlaskConical className="h-5 w-5" />
              )}
              Simular pagamento aprovado
            </Button>
          </div>
        ) : (
          <>
            {data.method === "PIX" && data.pixQrCodeUrl && (
              <div className="flex flex-col items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={data.pixQrCodeUrl}
                  alt="QR Code PIX"
                  className="h-56 w-56 rounded-xl border-2 border-border bg-white p-2"
                />
                {data.pixCopiaCola && (
                  <div className="flex w-full flex-col gap-2">
                    <p className="break-all rounded-lg border bg-muted/40 p-2 text-xs text-muted-foreground">
                      {data.pixCopiaCola}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => copiar(data.pixCopiaCola ?? "")}
                      className="h-12 text-base"
                    >
                      <Copy className="h-5 w-5" />
                      Copiar código PIX
                    </Button>
                  </div>
                )}
              </div>
            )}

            {data.method === "CARTAO" && (
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  pagarCartao()
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
                  type="email"
                  placeholder="E-mail do titular do cartão"
                  value={cardHolderEmail}
                  onChange={(e) => setCardHolderEmail(e.target.value)}
                  autoComplete="email"
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
                  disabled={pending}
                >
                  {pending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <CreditCard className="h-5 w-5" />
                  )}
                  Pagar R$ {valor} com cartão
                </Button>
              </form>
            )}

            {data.method === "APPLE_PAY" && data.checkoutUrl && (
              <Button
                type="button"
                className="h-14 w-full text-lg"
                render={
                  <a
                    href={data.checkoutUrl}
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
              onClick={verificarAgora}
              disabled={pending}
              className="h-12 text-base"
            >
              {pending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <BadgeCheck className="h-5 w-5" />
              )}
              Já paguei — verificar
            </Button>

            {(
              ["PIX", "CARTAO", "APPLE_PAY"] as const
            ).filter((m) => m !== data.method).length > 0 && (
              <div className="flex flex-col gap-2">
                {!showTrocarMetodo ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowTrocarMetodo(true)}
                    disabled={pending}
                    className="h-12 text-base"
                  >
                    <RefreshCw className="h-5 w-5" />
                    Trocar forma de pagamento
                  </Button>
                ) : (
                  <div className="rounded-xl border-2 border-border p-3">
                    <p className="mb-2 text-center text-sm text-muted-foreground">
                      Escolha outra forma de pagamento:
                    </p>
                    <div className="flex flex-col gap-2">
                      {(["PIX", "CARTAO", "APPLE_PAY"] as const)
                        .filter((m) => m !== data.method)
                        .map((metodo) => (
                          <Button
                            key={metodo}
                            type="button"
                            variant="outline"
                            onClick={() => trocarMetodo(metodo)}
                            disabled={pending}
                            className="h-12 text-base"
                          >
                            {pending ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : null}
                            {METODO_LABEL[metodo]}
                          </Button>
                        ))}
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setShowTrocarMetodo(false)}
                        className="h-10 text-sm"
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <p className="text-center text-sm text-muted-foreground">
              Assim que o pagamento for confirmado, tudo é atualizado
              automaticamente.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
