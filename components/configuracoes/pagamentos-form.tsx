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
  Stethoscope,
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
import { Switch } from "@/components/ui/switch"
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
  consultaPrecoDomiciliarFora: number | null
  consultaPrecoTeleconsulta: number | null
  acompValorBaixa: number | null
  acompValorMedia: number | null
  acompValorAlta: number | null
  jurosParcelamento: number | null
  pixEnabled: boolean
  cartaoEnabled: boolean
  applePayEnabled: boolean
  dinheiroEnabled: boolean
}

type TestResult = { success: boolean; message: string } | null

/** Linha de toggle de forma de pagamento liberada no agendamento online. */
function PaymentMethodToggle({
  label,
  description,
  checked,
  onChange,
  inputName,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
  inputName: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b pb-3 last:border-b-0 last:pb-0">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
        <input type="hidden" name={inputName} value={checked ? "on" : ""} />
      </div>
    </div>
  )
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

export function PagamentosForm({
  initial,
  enabledModalities,
}: {
  initial: PaymentInitialData
  /** Modalidades ligadas no agendamento online (Dados da clínica). */
  enabledModalities: {
    presencial: boolean
    domiciliar: boolean
    teleconsulta: boolean
  }
}) {
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
  const [precoDomiciliarFora, setPrecoDomiciliarFora] = useState(
    initial.consultaPrecoDomiciliarFora != null
      ? String(initial.consultaPrecoDomiciliarFora).replace(".", ",")
      : ""
  )
  const [precoTeleconsulta, setPrecoTeleconsulta] = useState(
    initial.consultaPrecoTeleconsulta != null
      ? String(initial.consultaPrecoTeleconsulta).replace(".", ",")
      : ""
  )
  const [acompBaixa, setAcompBaixa] = useState(
    initial.acompValorBaixa != null
      ? String(initial.acompValorBaixa).replace(".", ",")
      : ""
  )
  const [acompMedia, setAcompMedia] = useState(
    initial.acompValorMedia != null
      ? String(initial.acompValorMedia).replace(".", ",")
      : ""
  )
  const [acompAlta, setAcompAlta] = useState(
    initial.acompValorAlta != null
      ? String(initial.acompValorAlta).replace(".", ",")
      : ""
  )
  const [jurosParcelamento, setJurosParcelamento] = useState(
    initial.jurosParcelamento != null
      ? String(initial.jurosParcelamento).replace(".", ",")
      : ""
  )

  const [pixEnabled, setPixEnabled] = useState(initial.pixEnabled)
  const [cartaoEnabled, setCartaoEnabled] = useState(initial.cartaoEnabled)
  const [applePayEnabled, setApplePayEnabled] = useState(
    initial.applePayEnabled
  )
  const [dinheiroEnabled, setDinheiroEnabled] = useState(
    initial.dinheiroEnabled
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

  // Converte o campo de preço (aceita vírgula) para número.
  function parseMoney(text: string): number {
    const parsed = Number(text.trim().replace(".", "").replace(",", "."))
    return Number.isFinite(parsed) ? parsed : 0
  }

  // Modalidade habilitada sem preço: o agendamento online confirma o
  // horário sem cobrança — aviso preventivo para o admin configurar.
  const missingPriceModalities = [
    enabledModalities.presencial && parseMoney(precoPresencial) <= 0
      ? "Presencial"
      : null,
    enabledModalities.domiciliar && parseMoney(precoDomiciliar) <= 0
      ? "Domiciliar"
      : null,
    enabledModalities.teleconsulta && parseMoney(precoTeleconsulta) <= 0
      ? "Teleconsulta"
      : null,
  ].filter((label): label is string => label !== null)

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
          {/* Formas de pagamento liberadas no agendamento online */}
          <div className="flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2 font-medium">
                <Wallet className="h-4 w-4 text-primary" />
                Formas de pagamento do agendamento online
              </div>
              <p className="text-xs text-muted-foreground">
                Quais meios o cliente pode escolher ao agendar com pagamento
                antecipado. A equipe continua podendo cobrar por qualquer
                meio internamente (Financeiro).
              </p>
            </div>
            <PaymentMethodToggle
              label="PIX"
              description="QR code + copia-e-cola gerados na hora pelo Asaas."
              checked={pixEnabled}
              onChange={setPixEnabled}
              inputName="pixEnabled"
            />
            <PaymentMethodToggle
              label="Cartão de crédito"
              description="Link de pagamento do Asaas com checkout do cartão."
              checked={cartaoEnabled}
              onChange={setCartaoEnabled}
              inputName="cartaoEnabled"
            />
            <PaymentMethodToggle
              label="Apple Pay"
              description="Checkout do Stripe — só aparece ao cliente com a chave do Stripe configurada abaixo."
              checked={applePayEnabled}
              onChange={setApplePayEnabled}
              inputName="applePayEnabled"
            />
            <PaymentMethodToggle
              label="Dinheiro"
              description="Só presencial/domiciliar — o cliente paga para o médico no momento do atendimento."
              checked={dinheiroEnabled}
              onChange={setDinheiroEnabled}
              inputName="dinheiroEnabled"
            />
          </div>

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
            {missingPriceModalities.length > 0 && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                {missingPriceModalities.join(", ")}{" "}
                {missingPriceModalities.length === 1
                  ? "está habilitada sem preço configurado — os agendamentos online desta modalidade são confirmados sem cobrança."
                  : "estão habilitadas sem preço configurado — os agendamentos online destas modalidades são confirmados sem cobrança."}
              </p>
            )}
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
                <FieldLabel>Domiciliar — dentro do raio urbano (R$)</FieldLabel>
                <Input
                  name="consultaPrecoDomiciliar"
                  type="text"
                  inputMode="decimal"
                  value={precoDomiciliar}
                  onChange={(event) => setPrecoDomiciliar(event.target.value)}
                  placeholder="Ex.: 500,00"
                />
              </Field>
              <Field>
                <FieldLabel>Domiciliar — fora do raio urbano (R$)</FieldLabel>
                <Input
                  name="consultaPrecoDomiciliarFora"
                  type="text"
                  inputMode="decimal"
                  value={precoDomiciliarFora}
                  onChange={(event) =>
                    setPrecoDomiciliarFora(event.target.value)
                  }
                  placeholder="Ex.: 550,00"
                />
              </Field>
              <Field>
                <FieldLabel>Teleconsulta (R$)</FieldLabel>
                <Input
                  name="consultaPrecoTeleconsulta"
                  type="text"
                  inputMode="decimal"
                  value={precoTeleconsulta}
                  onChange={(event) => setPrecoTeleconsulta(event.target.value)}
                  placeholder="Ex.: 200,00"
                />
              </Field>
            </div>
          </div>

          {/* Acompanhamentos: sugestões de valor e juros do parcelamento */}
          <div className="flex flex-col gap-4 rounded-lg border p-4">
            <div className="flex items-center gap-2 font-medium">
              <Stethoscope className="h-4 w-4 text-primary" />
              Acompanhamentos
            </div>
            <p className="text-xs text-muted-foreground">
              Valores sugeridos por complexidade no modal de iniciar
              acompanhamento (o médico pode editar na hora) e os juros
              mensais repassados ao paciente ao parcelar no cartão.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>Complexidade baixa (R$)</FieldLabel>
                <Input
                  name="acompValorBaixa"
                  type="text"
                  inputMode="decimal"
                  value={acompBaixa}
                  onChange={(event) => setAcompBaixa(event.target.value)}
                  placeholder="Ex.: 500,00"
                />
              </Field>
              <Field>
                <FieldLabel>Complexidade média (R$)</FieldLabel>
                <Input
                  name="acompValorMedia"
                  type="text"
                  inputMode="decimal"
                  value={acompMedia}
                  onChange={(event) => setAcompMedia(event.target.value)}
                  placeholder="Ex.: 900,00"
                />
              </Field>
              <Field>
                <FieldLabel>Complexidade alta (R$)</FieldLabel>
                <Input
                  name="acompValorAlta"
                  type="text"
                  inputMode="decimal"
                  value={acompAlta}
                  onChange={(event) => setAcompAlta(event.target.value)}
                  placeholder="Ex.: 1.500,00"
                />
              </Field>
              <Field>
                <FieldLabel>Juros do parcelamento (% ao mês)</FieldLabel>
                <Input
                  name="jurosParcelamento"
                  type="text"
                  inputMode="decimal"
                  value={jurosParcelamento}
                  onChange={(event) => setJurosParcelamento(event.target.value)}
                  placeholder="Ex.: 2,99"
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
