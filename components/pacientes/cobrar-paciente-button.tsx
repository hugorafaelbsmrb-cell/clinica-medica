"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Copy,
  CreditCard,
  ExternalLink,
  Loader2,
  MessageCircle,
  QrCode,
  Wallet,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import {
  createStandaloneCharge,
  type CreatePaymentResult,
} from "@/lib/actions/pagamentos"
import { cn } from "@/lib/utils"

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value)
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

/** Converte "1.234,56" ou "1234,56" para número. */
function parseAmount(text: string): number | null {
  const normalized = text.trim().replace(/\./g, "").replace(",", ".")
  if (!normalized) return null
  const value = Number(normalized)
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Cobrança avulsa: admin, médico e secretária enviam uma cobrança direta
 * para o paciente (PIX ou link de cartão), com valor livre. Um lançamento
 * de receita é criado junto e baixado automaticamente quando o paciente paga.
 */
export function CobrarPacienteButton({
  patientId,
  patientName,
  sugestaoValor,
}: {
  patientId: string
  patientName: string
  sugestaoValor: number | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [method, setMethod] = useState<"PIX" | "CARTAO">("PIX")
  const [amount, setAmount] = useState(
    sugestaoValor != null ? String(sugestaoValor).replace(".", ",") : ""
  )
  const [description, setDescription] = useState(`Consulta — ${patientName}`)
  const [result, setResult] = useState<CreatePaymentResult | null>(null)
  const [error, setError] = useState("")
  const [pending, startCharge] = useTransition()

  function reset() {
    setResult(null)
    setError("")
  }

  function handleOpen(openNow: boolean) {
    setOpen(openNow)
    if (openNow) reset()
  }

  function handleCharge() {
    setError("")
    const value = parseAmount(amount)
    if (value == null) {
      setError("Informe um valor válido (ex.: 150,00)")
      return
    }
    if (description.trim().length < 3) {
      setError("Descreva a cobrança")
      return
    }
    startCharge(async () => {
      const res = await createStandaloneCharge({
        patientId,
        amount: value,
        method,
        description: description.trim(),
      })
      if (res.success) {
        setResult(res)
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

  const shareText = (url: string) =>
    `https://wa.me/?text=${encodeURIComponent(
      `Olá, ${patientName}! Segue o link para pagamento (${description}): ${url}`
    )}`

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Wallet className="h-4 w-4" />
        Cobrar
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar cobrança avulsa</DialogTitle>
          <DialogDescription>
            Gera um pagamento para {patientName} (PIX ou link de cartão). O
            lançamento entra no Financeiro e é baixado sozinho quando o
            pagamento for confirmado.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMethod("PIX")}
                className={cn(
                  "flex h-14 items-center justify-center gap-2 rounded-lg border-2 text-base font-semibold transition-colors",
                  method === "PIX"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:bg-muted"
                )}
              >
                <QrCode className="h-5 w-5" />
                PIX
              </button>
              <button
                type="button"
                onClick={() => setMethod("CARTAO")}
                className={cn(
                  "flex h-14 items-center justify-center gap-2 rounded-lg border-2 text-base font-semibold transition-colors",
                  method === "CARTAO"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:bg-muted"
                )}
              >
                <CreditCard className="h-5 w-5" />
                Cartão
              </button>
            </div>

            <Field>
              <FieldLabel>Valor (R$)</FieldLabel>
              <Input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="Ex.: 150,00"
              />
            </Field>

            <Field>
              <FieldLabel>Descrição</FieldLabel>
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Ex.: Consulta domiciliar"
                maxLength={500}
              />
            </Field>

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
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleCharge}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wallet className="h-4 w-4" />
                )}
                Gerar cobrança
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
