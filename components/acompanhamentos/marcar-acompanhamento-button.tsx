"use client"

/**
 * Botão "Iniciar acompanhamento" (página do paciente) + modal de cobrança.
 *
 * Fluxo:
 *  1. Complexidade (Baixa/Média/Alta) com valores sugeridos das
 *     Configurações (editáveis) + descrição/motivo;
 *  2. Modo de cobrança:
 *     - À vista (INTEGRAL): PIX ou cartão com seletor de parcelas 1x–12x
 *       (Tabela Price com os juros configurados);
 *     - Recorrente: valor por ciclo + ciclo de 7/15/30 dias — primeira
 *       cobrança sai na hora, as próximas são geradas pelo cron.
 *  3. Resumo do valor final → confirmar → mostra o QR PIX/copia-e-cola ou o
 *     link do cartão com "Enviar pelo WhatsApp" (mesmo padrão do cobrar
 *     avulso, incluindo a simulação no modo teste).
 */
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  CalendarClock,
  Copy,
  CreditCard,
  ExternalLink,
  FlaskConical,
  HeartPulse,
  Loader2,
  MessageCircle,
  QrCode,
  Repeat,
  Stethoscope,
  Wallet,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { refreshPayment } from "@/lib/actions/pagamentos"
import {
  createFollowUpProgram,
  type CreateFollowUpResult,
} from "@/lib/actions/acompanhamentos"
import { priceTableInstallments } from "@/lib/acompanhamentos/pricing"
import { cn } from "@/lib/utils"

type Complexity = "BAIXA" | "MEDIA" | "ALTA"

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value)
}

/** Converte "1.234,56" ou "1234,56" para número. */
function parseAmount(text: string): number | null {
  const normalized = text.trim().replace(/\./g, "").replace(",", ".")
  if (!normalized) return null
  const value = Number(normalized)
  return Number.isFinite(value) && value > 0 ? value : null
}

async function copyText(text: string): Promise<boolean> {
  // Fallback para navegadores sem Clipboard API em contexto não seguro (HTTP).
  async function legacyCopy() {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(textarea)
    if (!ok) throw new Error("copy failed")
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      await legacyCopy()
    }
    return true
  } catch {
    return false
  }
}

const COMPLEXITY_OPTIONS: {
  value: Complexity
  label: string
}[] = [
  { value: "BAIXA", label: "Baixa" },
  { value: "MEDIA", label: "Média" },
  { value: "ALTA", label: "Alta" },
]

const CYCLE_OPTIONS = [7, 15, 30]

export function MarcarAcompanhamentoButton({
  patientId,
  patientName,
  sugestaoBaixa,
  sugestaoMedia,
  sugestaoAlta,
  jurosParcelamento,
}: {
  patientId: string
  patientName: string
  sugestaoBaixa: number | null
  sugestaoMedia: number | null
  sugestaoAlta: number | null
  jurosParcelamento: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const [complexity, setComplexity] = useState<Complexity | null>(null)
  const [baseValue, setBaseValue] = useState("")
  const [description, setDescription] = useState("")
  const [billingMode, setBillingMode] = useState<"INTEGRAL" | "RECORRENTE">(
    "INTEGRAL"
  )
  const [method, setMethod] = useState<"PIX" | "CARTAO">("PIX")
  const [installments, setInstallments] = useState(1)
  const [cycleDays, setCycleDays] = useState(30)

  const [result, setResult] = useState<CreateFollowUpResult | null>(null)
  const [error, setError] = useState("")
  const [pending, startCharge] = useTransition()
  const [pendingCheck, startCheck] = useTransition()

  const sugestoes: Record<Complexity, number | null> = {
    BAIXA: sugestaoBaixa,
    MEDIA: sugestaoMedia,
    ALTA: sugestaoAlta,
  }

  const value = parseAmount(baseValue)
  const table =
    value != null && billingMode === "INTEGRAL" && method === "CARTAO"
      ? priceTableInstallments(value, jurosParcelamento)
      : []
  const selectedRow = table.find((row) => row.installments === installments)

  // INTEGRAL → valor total (com juros quando parcelado); RECORRENTE → valor/ciclo
  const finalValue =
    billingMode === "INTEGRAL"
      ? method === "CARTAO"
        ? (selectedRow?.totalValue ?? value ?? 0)
        : (value ?? 0)
      : (value ?? 0)

  function reset() {
    setComplexity(null)
    setBaseValue("")
    setDescription("")
    setBillingMode("INTEGRAL")
    setMethod("PIX")
    setInstallments(1)
    setCycleDays(30)
    setResult(null)
    setError("")
  }

  function handleOpen(openNow: boolean) {
    setOpen(openNow)
    if (openNow) reset()
  }

  function selectComplexity(option: Complexity) {
    setComplexity(option)
    const sugestao = sugestoes[option]
    if (sugestao != null && sugestao > 0) {
      setBaseValue(String(sugestao).replace(".", ","))
    }
  }

  function handleConfirm() {
    setError("")
    if (!complexity) {
      setError("Selecione a complexidade do acompanhamento")
      return
    }
    if (value == null) {
      setError("Informe um valor válido (ex.: 900,00)")
      return
    }
    startCharge(async () => {
      const res = await createFollowUpProgram({
        patientId,
        complexity,
        description: description.trim() || null,
        billingMode,
        baseValue: value,
        method,
        installments:
          billingMode === "INTEGRAL" && method === "CARTAO"
            ? installments
            : undefined,
        cycleDays: billingMode === "RECORRENTE" ? cycleDays : undefined,
      })
      if (res.success) {
        setResult(res)
        router.refresh()
      } else {
        setError(res.message)
        toast.error(res.message)
      }
    })
  }

  async function handleCopy(text: string, label: string) {
    const ok = await copyText(text)
    if (ok) toast.success(`${label} copiado`)
    else toast.error("Não foi possível copiar — selecione manualmente")
  }

  // Simula a aprovação de uma cobrança em modo teste (gateway sem chave)
  function handleSimulate() {
    if (!result?.paymentId) return
    startCheck(async () => {
      const res = await refreshPayment(result.paymentId ?? "")
      if (res.success) {
        toast.success("Pagamento de teste confirmado — lançamento baixado")
        setOpen(false)
        router.refresh()
      } else {
        toast.error(res.message)
      }
    })
  }

  const shareText = (url: string) =>
    `https://wa.me/?text=${encodeURIComponent(
      `Olá, ${patientName}! Segue o link para pagamento do seu acompanhamento: ${url}`
    )}`

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger render={<Button />}>
        <Stethoscope className="h-4 w-4" />
        Iniciar acompanhamento
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Iniciar acompanhamento</DialogTitle>
          <DialogDescription>
            Define a complexidade do tratamento de {patientName} e gera a
            cobrança na hora — à vista (PIX ou cartão parcelado) ou por ciclo
            recorrente.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="flex flex-col gap-4">
            {/* 1. Complexidade */}
            <Field>
              <FieldLabel>Complexidade do tratamento *</FieldLabel>
              <div className="grid grid-cols-3 gap-2">
                {COMPLEXITY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => selectComplexity(option.value)}
                    className={cn(
                      "flex h-16 flex-col items-center justify-center gap-0.5 rounded-lg border-2 text-sm font-semibold transition-colors",
                      complexity === option.value
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border hover:bg-muted"
                    )}
                  >
                    <span>{option.label}</span>
                    {sugestoes[option.value] != null &&
                      sugestoes[option.value]! > 0 && (
                        <span className="text-xs font-normal text-muted-foreground">
                          {formatCurrency(sugestoes[option.value]!)}
                        </span>
                      )}
                  </button>
                ))}
              </div>
            </Field>

            <Field>
              <FieldLabel>Valor (R$) *</FieldLabel>
              <Input
                type="text"
                inputMode="decimal"
                value={baseValue}
                onChange={(event) => setBaseValue(event.target.value)}
                placeholder="Ex.: 900,00"
              />
              <p className="text-xs text-muted-foreground">
                Pré-preenchido pela sugestão da complexidade — edite se
                necessário.
              </p>
            </Field>

            <Field>
              <FieldLabel>Descrição / motivo do acompanhamento</FieldLabel>
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Ex.: acompanhamento pós-cirúrgico, controle de diabetes..."
                rows={2}
                maxLength={2000}
              />
            </Field>

            {/* 2. Modo de cobrança */}
            <Field>
              <FieldLabel>Modo de cobrança *</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBillingMode("INTEGRAL")}
                  className={cn(
                    "flex h-14 items-center justify-center gap-2 rounded-lg border-2 text-sm font-semibold transition-colors",
                    billingMode === "INTEGRAL"
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:bg-muted"
                  )}
                >
                  <Wallet className="h-4 w-4" />
                  À vista (integral)
                </button>
                <button
                  type="button"
                  onClick={() => setBillingMode("RECORRENTE")}
                  className={cn(
                    "flex h-14 items-center justify-center gap-2 rounded-lg border-2 text-sm font-semibold transition-colors",
                    billingMode === "RECORRENTE"
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:bg-muted"
                  )}
                >
                  <Repeat className="h-4 w-4" />
                  Recorrente
                </button>
              </div>
            </Field>

            {/* Meio de pagamento */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMethod("PIX")}
                className={cn(
                  "flex h-12 items-center justify-center gap-2 rounded-lg border-2 text-sm font-semibold transition-colors",
                  method === "PIX"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:bg-muted"
                )}
              >
                <QrCode className="h-4 w-4" />
                PIX
              </button>
              <button
                type="button"
                onClick={() => setMethod("CARTAO")}
                className={cn(
                  "flex h-12 items-center justify-center gap-2 rounded-lg border-2 text-sm font-semibold transition-colors",
                  method === "CARTAO"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:bg-muted"
                )}
              >
                <CreditCard className="h-4 w-4" />
                Cartão
              </button>
            </div>

            {/* Parcelamento (só à vista no cartão) */}
            {billingMode === "INTEGRAL" && method === "CARTAO" && value != null && (
              <Field>
                <FieldLabel>Parcelas (com juros de {jurosParcelamento}% a.m.)</FieldLabel>
                <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto rounded-lg border p-1">
                  {table.map((row) => (
                    <button
                      key={row.installments}
                      type="button"
                      onClick={() => setInstallments(row.installments)}
                      className={cn(
                        "flex items-center justify-between rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                        installments === row.installments
                          ? "bg-primary/10 font-semibold text-primary"
                          : "hover:bg-muted"
                      )}
                    >
                      <span>
                        {row.installments}x de {formatCurrency(row.installmentValue)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        total {formatCurrency(row.totalValue)}
                      </span>
                    </button>
                  ))}
                </div>
              </Field>
            )}

            {/* Ciclo (só recorrente) */}
            {billingMode === "RECORRENTE" && (
              <Field>
                <FieldLabel>Ciclo de cobrança *</FieldLabel>
                <div className="grid grid-cols-3 gap-2">
                  {CYCLE_OPTIONS.map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => setCycleDays(days)}
                      className={cn(
                        "flex h-12 items-center justify-center gap-1 rounded-lg border-2 text-sm font-semibold transition-colors",
                        cycleDays === days
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border hover:bg-muted"
                      )}
                    >
                      <CalendarClock className="h-4 w-4" />
                      {days}d
                    </button>
                  ))}
                </div>
              </Field>
            )}

            {/* 3. Resumo */}
            <div className="flex flex-col gap-1.5 rounded-lg bg-muted/60 p-3 text-sm">
              <p className="flex items-center gap-1.5 font-medium">
                <HeartPulse className="h-4 w-4 text-primary" />
                Resumo
              </p>
              <p className="text-muted-foreground">
                {billingMode === "INTEGRAL" ? "Cobrança única" : "Cobrança por ciclo"} via{" "}
                {method === "PIX" ? "PIX" : "cartão"}
                {billingMode === "INTEGRAL" &&
                  method === "CARTAO" &&
                  ` em ${installments}x de ${formatCurrency(
                    selectedRow?.installmentValue ?? 0
                  )}`}
                {billingMode === "RECORRENTE" &&
                  ` a cada ${cycleDays} dias — as próximas cobranças são geradas automaticamente e enviadas pelo WhatsApp`}
              </p>
              <p className="text-base font-semibold">
                {billingMode === "INTEGRAL"
                  ? `Total: ${formatCurrency(finalValue)}`
                  : `Valor por ciclo: ${formatCurrency(finalValue)}`}
              </p>
            </div>

            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {result.method === "PIX" && result.pixQrCodeUrl && (
              <div className="flex flex-col items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.pixQrCodeUrl}
                  alt="QR Code PIX"
                  className="h-48 w-48 rounded-lg border bg-white p-2"
                />
                {result.pixCopiaCola && (
                  <div className="flex w-full flex-col gap-2">
                    <p className="break-all rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
                      {result.pixCopiaCola}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        handleCopy(result.pixCopiaCola ?? "", "Código PIX")
                      }
                    >
                      <Copy className="h-4 w-4" />
                      Copiar código PIX
                    </Button>
                  </div>
                )}
              </div>
            )}

            {result.checkoutUrl && (
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="outline"
                  render={
                    <a
                      href={result.checkoutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  <ExternalLink className="h-4 w-4" />
                  Abrir link de pagamento
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  render={
                    <a
                      href={shareText(result.checkoutUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  <MessageCircle className="h-4 w-4" />
                  Enviar pelo WhatsApp
                </Button>
              </div>
            )}

            {result.method === "PIX" &&
              !result.pixQrCodeUrl &&
              result.pixCopiaCola && (
                <div className="flex flex-col gap-2">
                  <p className="break-all rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
                    {result.pixCopiaCola}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      handleCopy(result.pixCopiaCola ?? "", "Código PIX")
                    }
                  >
                    <Copy className="h-4 w-4" />
                    Copiar código PIX
                  </Button>
                </div>
              )}

            {result.mock && (
              <div className="flex flex-col gap-2">
                <p className="rounded-md border-2 border-dashed border-primary/40 bg-primary/5 p-3 text-xs text-muted-foreground">
                  Modo teste: o gateway ainda não tem chave configurada. A
                  simulação confirma o pagamento e baixa o lançamento no
                  Financeiro — o caminho é o mesmo do webhook real.
                </p>
                <Button
                  type="button"
                  onClick={handleSimulate}
                  disabled={pendingCheck}
                >
                  {pendingCheck ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FlaskConical className="h-4 w-4" />
                  )}
                  Simular pagamento aprovado
                </Button>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              A confirmação chega pelo webhook do gateway — o lançamento é
              baixado sozinho, sem conciliação manual.
            </p>
          </div>
        )}

        <DialogFooter>
          {!result ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button type="button" onClick={handleConfirm} disabled={pending}>
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wallet className="h-4 w-4" />
                )}
                {pending ? "Gerando..." : "Confirmar e gerar cobrança"}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false)
                router.refresh()
              }}
            >
              Fechar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
