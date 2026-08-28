"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  BadgeCheck,
  Copy,
  CreditCard,
  ExternalLink,
  Loader2,
  MessageCircle,
  QrCode,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  createPaymentForEntry,
  refreshPayment,
  sendPaymentLinkByWhatsApp,
  type CreatePaymentResult,
} from "@/lib/actions/pagamentos"
import { paymentPageUrl } from "@/lib/payments/url"

type EntryPayment = {
  id: string
  status: string
  method: string
  checkoutUrl: string | null
  pixCopiaCola: string | null
  pixQrCodeUrl: string | null
}

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

export function CobrarButton({
  entryId,
  description,
  value,
  existingPayment,
}: {
  entryId: string
  description: string
  value: number
  existingPayment: EntryPayment | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<CreatePaymentResult | null>(null)
  const [pendingCreate, startCreate] = useTransition()
  const [pendingCheck, startCheck] = useTransition()
  const [pendingSend, startSend] = useTransition()

  const pendingPayment =
    existingPayment && existingPayment.status === "PENDENTE"
      ? existingPayment
      : null

  function handleMethod(method: "PIX" | "CARTAO") {
    setResult(null)
    startCreate(async () => {
      const res = await createPaymentForEntry({ entryId, method })
      if (res.success) {
        setResult(res)
      } else {
        toast.error(res.message)
      }
    })
  }

  function handleCheck(paymentId: string) {
    startCheck(async () => {
      const res = await refreshPayment(paymentId)
      if (res.success) {
        toast.success(res.message)
        router.refresh()
        setResult(null)
        setOpen(false)
      } else {
        toast.error(res.message)
      }
    })
  }

  async function handleCopy(text: string, label: string) {
    const ok = await copyText(text)
    if (ok) toast.success(`${label} copiado`)
    else toast.error("Não foi possível copiar — selecione manualmente")
  }

  // Envia o link pelo WhatsApp via API (W-API) — o usuário permanece na página.
  function handleSendWhatsApp(paymentId: string | null) {
    if (!paymentId) return
    startSend(async () => {
      const res = await sendPaymentLinkByWhatsApp(paymentId)
      if (res.success) toast.success(res.message)
      else toast.error(res.message)
    })
  }

  const resultPaymentId = result?.paymentId ?? pendingPayment?.id ?? null
  // Sempre a página de pagamento do próprio sistema (transparente),
  // em vez do checkout hospedado do gateway.
  const resultUrl = resultPaymentId
    ? paymentPageUrl(resultPaymentId)
    : (result?.checkoutUrl ?? pendingPayment?.checkoutUrl ?? null)
  const resultPix = result?.pixCopiaCola ?? pendingPayment?.pixCopiaCola ?? null
  const resultQr = result?.pixQrCodeUrl ?? pendingPayment?.pixQrCodeUrl ?? null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <CreditCard className="h-4 w-4" />
        Cobrar
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Gerar cobrança</DialogTitle>
          <DialogDescription>
            {description} · {formatCurrency(value)}. O pagamento confirmado
            baixa o lançamento sozinho.
          </DialogDescription>
        </DialogHeader>

        {/* Escolha do meio de pagamento */}
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => handleMethod("PIX")}
            disabled={pendingCreate}
            className="flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
          >
            <QrCode className="h-6 w-6 text-emerald-600" />
            <p className="text-sm font-medium">PIX (Asaas)</p>
            <p className="text-xs text-muted-foreground">
              QR code + copia-e-cola na hora
            </p>
          </button>
          <button
            type="button"
            onClick={() => handleMethod("CARTAO")}
            disabled={pendingCreate}
            className="flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/20"
          >
            <CreditCard className="h-6 w-6 text-blue-600" />
            <p className="text-sm font-medium">Cartão · Apple Pay</p>
            <p className="text-xs text-muted-foreground">
              Checkout do Stripe, parcelado em até 12x
            </p>
          </button>
        </div>

        {pendingCreate && (
          <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Gerando cobrança...
          </div>
        )}

        {/* Resultado: PIX */}
        {result?.method === "PIX" && (resultQr || result.pixCopiaCola) && (
          <div className="flex flex-col gap-3 rounded-lg border p-4">
            <p className="text-sm font-medium">Cobrança PIX gerada</p>
            <div className="flex items-start gap-3">
              {resultQr && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={resultQr}
                  alt="QR code PIX"
                  className="h-32 w-32 rounded-md border"
                />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  Envie o QR ou o código copia-e-cola para o paciente:
                </p>
                {result.pixCopiaCola && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() =>
                      handleCopy(result.pixCopiaCola ?? "", "Código PIX")
                    }
                  >
                    <Copy className="h-4 w-4" />
                    Copiar copia-e-cola
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => handleCopy(resultUrl ?? "", "Link de pagamento")}
                >
                  <ExternalLink className="h-4 w-4" />
                  Copiar link
                </Button>
                {resultUrl && (
                  <button
                    type="button"
                    disabled={pendingSend}
                    onClick={() => handleSendWhatsApp(resultPaymentId)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    {pendingSend ? "Enviando..." : "Enviar pelo WhatsApp"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Resultado: cartão/Apple Pay */}
        {(result?.method === "CARTAO" || (pendingPayment && pendingPayment.method === "CARTAO")) &&
          resultUrl && (
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <p className="text-sm font-medium">
                Link de pagamento (cartão · Apple Pay)
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleCopy(resultUrl, "Link de pagamento")}
              >
                <Copy className="h-4 w-4" />
                Copiar link
              </Button>
              <button
                type="button"
                disabled={pendingSend}
                onClick={() => handleSendWhatsApp(resultPaymentId)}
                className="flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <MessageCircle className="h-4 w-4" />
                {pendingSend ? "Enviando..." : "Enviar pelo WhatsApp"}
              </button>
            </div>
          )}

        {/* Cobrança PIX pendente já existente */}
        {pendingPayment && pendingPayment.method === "PIX" && !result && resultUrl && (
          <div className="flex flex-col gap-3 rounded-lg border p-4">
            <p className="text-sm font-medium">
              Já existe uma cobrança PIX aberta para este lançamento
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleCopy(pendingPayment.pixCopiaCola ?? "", "Código PIX")}
              >
                <Copy className="h-4 w-4" />
                Copiar copia-e-cola
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleCopy(resultUrl, "Link de pagamento")}
              >
                <ExternalLink className="h-4 w-4" />
                Copiar link
              </Button>
              <button
                type="button"
                disabled={pendingSend}
                onClick={() => handleSendWhatsApp(resultPaymentId)}
                className="flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                {pendingSend ? "Enviando..." : "WhatsApp"}
              </button>
            </div>
          </div>
        )}

        <DialogFooter className="!justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => resultPaymentId && handleCheck(resultPaymentId)}
            disabled={pendingCheck || !resultPaymentId}
          >
            {pendingCheck ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Verificar pagamento
          </Button>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <BadgeCheck className="h-3.5 w-3.5" />
            A confirmação chega pelo webhook — sem conciliação manual
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
