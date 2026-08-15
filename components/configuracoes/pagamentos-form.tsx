"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowRight,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  QrCode,
  Wallet,
  Webhook,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  savePaymentSettings,
  testPaymentGateway,
  type ActionState,
} from "@/lib/actions/pagamentos"

export type PaymentInitialData = {
  asaasApiKey: string
  stripeSecretKey: string
  stripeWebhookSecret: string
  asaasWebhookUrl: string
  stripeWebhookUrl: string
  consultaPrecoPresencial: number | null
  consultaPrecoDomiciliar: number | null
}

type TestResult = { success: boolean; message: string } | null

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

export function PagamentosForm({ initial }: { initial: PaymentInitialData }) {
  const router = useRouter()

  const [asaasKey, setAsaasKey] = useState(initial.asaasApiKey)
  const [stripeKey, setStripeKey] = useState(initial.stripeSecretKey)
  const [stripeWebhook, setStripeWebhook] = useState(initial.stripeWebhookSecret)

  const [precoPresencial, setPrecoPresencial] = useState(
    initial.consultaPrecoPresencial != null
      ? String(initial.consultaPrecoPresencial).replace(".", ",")
      : ""
  )
  const [precoDomiciliar, setPrecoDomiciliar] = useState(
    initial.consultaPrecoDomiciliar != null
      ? String(initial.consultaPrecoDomiciliar).replace(".", ",")
      : ""
  )

  const [showAsaas, setShowAsaas] = useState(false)
  const [showStripe, setShowStripe] = useState(false)
  const [showStripeWebhook, setShowStripeWebhook] = useState(false)

  const [asaasTest, setAsaasTest] = useState<TestResult>(null)
  const [stripeTest, setStripeTest] = useState<TestResult>(null)

  const [pendingAsaas, startAsaasTest] = useTransition()
  const [pendingStripe, startStripeTest] = useTransition()

  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    savePaymentSettings,
    null
  )

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message)
      router.refresh()
    } else if (state && !state.success) {
      toast.error(state.message)
    }
  }, [state, router])

  function handleTest(provider: "ASAAS" | "STRIPE") {
    setAsaasTest(null)
    setStripeTest(null)

    if (provider === "ASAAS") {
      startAsaasTest(async () => {
        const result = await testPaymentGateway({ provider, asaasApiKey: asaasKey })
        setAsaasTest(result)
      })
      return
    }
    startStripeTest(async () => {
      const result = await testPaymentGateway({ provider, stripeSecretKey: stripeKey })
      setStripeTest(result)
    })
  }

  async function handleCopy(url: string, label: string) {
    const ok = await copyText(url)
    if (ok) toast.success(`${label} copiado`)
    else toast.error("Não foi possível copiar — selecione o endereço manualmente")
  }

  const asaasConfigured = !!initial.asaasApiKey
  const stripeConfigured = !!(initial.stripeSecretKey && initial.stripeWebhookSecret)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pagamentos</CardTitle>
        <CardDescription>
          Gateways de recebimento do paciente: PIX e cartão de crédito no
          Asaas; Apple Pay no Stripe. As chaves ficam guardadas no banco da
          clínica. Chave vazia = gateway desativado (fluxo cai em modo teste).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
          {/* Preços das consultas */}
          <div className="flex flex-col gap-4 rounded-lg border p-4">
            <div className="flex items-center gap-2 font-medium">
              <CreditCard className="h-4 w-4 text-primary" />
              Preços das consultas
            </div>
            <p className="text-xs text-muted-foreground">
              Com preço preenchido, o agendamento online passa a exigir o
              pagamento antes de confirmar o horário (o horário fica reservado
              até o pagamento). Deixe em branco para confirmar na hora, sem
              cobrança.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>Consulta presencial (R$)</FieldLabel>
                <Input
                  name="consultaPrecoPresencial"
                  type="text"
                  inputMode="decimal"
                  value={precoPresencial}
                  onChange={(event) => setPrecoPresencial(event.target.value)}
                  placeholder="Ex.: 200,00"
                />
              </Field>
              <Field>
                <FieldLabel>Consulta domiciliar (R$)</FieldLabel>
                <Input
                  name="consultaPrecoDomiciliar"
                  type="text"
                  inputMode="decimal"
                  value={precoDomiciliar}
                  onChange={(event) => setPrecoDomiciliar(event.target.value)}
                  placeholder="Ex.: 300,00"
                />
              </Field>
            </div>
          </div>

          {/* Roteamento por meio de pagamento */}
          <div className="flex flex-col gap-3 rounded-lg border p-4">
            <p className="text-sm font-medium">Como o sistema roteia cada cobrança</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-3 rounded-md border p-3">
                <QrCode className="h-8 w-8 shrink-0 text-emerald-600" />
                <div className="text-xs">
                  <p className="font-medium">PIX</p>
                  <p className="text-muted-foreground">
                    Gerado no <strong>Asaas</strong> — QR code + copia-e-cola na hora
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-md border p-3">
                <CreditCard className="h-8 w-8 shrink-0 text-blue-600" />
                <div className="text-xs">
                  <p className="font-medium">Cartão de crédito</p>
                  <p className="text-muted-foreground">
                    Link de pagamento do <strong>Asaas</strong> com checkout
                    do cartão
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-md border p-3">
                <Wallet className="h-8 w-8 shrink-0 text-indigo-600" />
                <div className="text-xs">
                  <p className="font-medium">Apple Pay</p>
                  <p className="text-muted-foreground">
                    Checkout do <strong>Stripe</strong> — aparece sozinho em
                    aparelhos Apple
                  </p>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Quando o pagamento é confirmado, o webhook do gateway baixa o
              lançamento do Financeiro automaticamente — sem conciliação manual.
            </p>
          </div>

          {/* ===== Asaas ===== */}
          <div className="flex flex-col gap-4 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-medium">
                <QrCode className="h-4 w-4 text-primary" />
                Asaas (PIX e cartão)
              </div>
              <Badge variant={asaasConfigured ? "secondary" : "outline"}>
                {asaasConfigured ? "Configurado" : "Não configurado"}
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              Crie a chave no painel do Asaas em <strong>Integrações → Chaves de API</strong>.
              Cobranças PIX têm taxa a partir de 0,99%; o cartão é cobrado pelo
              link de pagamento do próprio Asaas.
            </p>

            <Field>
              <FieldLabel>Chave da API</FieldLabel>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    name="asaasApiKey"
                    type={showAsaas ? "text" : "password"}
                    value={asaasKey}
                    onChange={(event) => {
                      setAsaasKey(event.target.value)
                      setAsaasTest(null)
                    }}
                    placeholder="$aact_..."
                    autoComplete="off"
                    className="pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAsaas((value) => !value)}
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showAsaas ? "Ocultar chave" : "Mostrar chave"}
                  >
                    {showAsaas ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleTest("ASAAS")}
                  disabled={pendingAsaas || !asaasKey.trim()}
                >
                  {pendingAsaas ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="h-4 w-4" />
                  )}
                  Testar chave
                </Button>
              </div>
            </Field>

            {asaasTest && (
              <p
                className={
                  asaasTest.success
                    ? "text-sm text-green-600 dark:text-green-400"
                    : "text-sm text-destructive"
                }
              >
                {asaasTest.message}
              </p>
            )}

            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">Webhook do Asaas</p>
                <p className="text-xs text-muted-foreground">
                  Cole no painel do Asaas (Webhooks). Eventos de pagamento
                  (RECEIVED/CONFIRMED/OVERDUE) chegam por aqui.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleCopy(initial.asaasWebhookUrl, "Endereço do webhook")}
              >
                <Copy className="h-4 w-4" />
                Copiar
              </Button>
            </div>
          </div>

          {/* ===== Stripe ===== */}
          <div className="flex flex-col gap-4 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-medium">
                <CreditCard className="h-4 w-4 text-primary" />
                Stripe (Apple Pay)
              </div>
              <Badge variant={stripeConfigured ? "secondary" : "outline"}>
                {stripeConfigured ? "Configurado" : "Não configurado"}
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              Crie as chaves no Dashboard do Stripe em{" "}
              <strong>Developers → API keys</strong>. Por enquanto só o Apple
              Pay passa por aqui (taxa de 3,99% + R$0,39); PIX e cartão ficam
              no Asaas.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>Chave secreta (secret key)</FieldLabel>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      name="stripeSecretKey"
                      type={showStripe ? "text" : "password"}
                      value={stripeKey}
                      onChange={(event) => {
                        setStripeKey(event.target.value)
                        setStripeTest(null)
                      }}
                      placeholder="sk_live_..."
                      autoComplete="off"
                      className="pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowStripe((value) => !value)}
                      className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showStripe ? "Ocultar chave" : "Mostrar chave"}
                    >
                      {showStripe ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleTest("STRIPE")}
                    disabled={pendingStripe || !stripeKey.trim()}
                  >
                    {pendingStripe ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <KeyRound className="h-4 w-4" />
                    )}
                    Testar
                  </Button>
                </div>
              </Field>

              <Field>
                <FieldLabel>Segredo do webhook (webhook secret)</FieldLabel>
                <div className="relative">
                  <Input
                    name="stripeWebhookSecret"
                    type={showStripeWebhook ? "text" : "password"}
                    value={stripeWebhook}
                    onChange={(event) => setStripeWebhook(event.target.value)}
                    placeholder="whsec_..."
                    autoComplete="off"
                    className="pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowStripeWebhook((value) => !value)}
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={
                      showStripeWebhook ? "Ocultar segredo" : "Mostrar segredo"
                    }
                  >
                    {showStripeWebhook ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </Field>
            </div>

            {stripeTest && (
              <p
                className={
                  stripeTest.success
                    ? "text-sm text-green-600 dark:text-green-400"
                    : "text-sm text-destructive"
                }
              >
                {stripeTest.message}
              </p>
            )}

            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">Webhook do Stripe</p>
                <p className="text-xs text-muted-foreground">
                  Cadastre no Dashboard (Developers → Webhooks) com o evento{" "}
                  <strong>checkout.session.completed</strong>. A assinatura de
                  cada chamada é validada com o segredo acima.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  handleCopy(initial.stripeWebhookUrl, "Endereço do webhook")
                }
              >
                <Copy className="h-4 w-4" />
                Copiar
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <p className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <Webhook className="h-3.5 w-3.5" />
              Sem chave configurada, o botão de cobrança no Financeiro avisa e
              não gera link.
            </p>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              Salvar pagamentos
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
