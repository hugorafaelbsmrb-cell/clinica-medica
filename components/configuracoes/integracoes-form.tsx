"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Bot,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MessageCircle,
  Phone,
  QrCode,
  RefreshCw,
  ShieldCheck,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  checkWhatsAppConnection,
  generatePairingCode,
  generateQrCode,
  saveIntegrations,
  testIntegration,
  type ActionState,
  type ConnectResult,
} from "@/lib/actions/integracoes"

export type IntegrationInitialData = {
  deepseekApiKey: string
  wApiInstance: string
  wApiToken: string
  birdIdBaseUrl: string
  birdIdClientId: string
  /** true quando há client_secret salvo — o valor nunca chega à tela. */
  birdIdClientSecretSet: boolean
  clinicPhone?: string | null
}

type TestResult = { success: boolean; message: string } | null

export function IntegracoesForm({
  initial,
  clinicPhone,
  webhookUrl,
}: {
  initial: IntegrationInitialData
  clinicPhone?: string | null
  webhookUrl: string
}) {
  const router = useRouter()

  const [deepseekKey, setDeepseekKey] = useState(initial.deepseekApiKey)
  const [wApiInstance, setWApiInstance] = useState(initial.wApiInstance)
  const [wApiToken, setWApiToken] = useState(initial.wApiToken)

  const [birdIdBaseUrl, setBirdIdBaseUrl] = useState(
    initial.birdIdBaseUrl || "https://api.birdid.com.br"
  )
  const [birdIdClientId, setBirdIdClientId] = useState(initial.birdIdClientId)
  const [birdIdClientSecret, setBirdIdClientSecret] = useState("")

  const [showDeepseek, setShowDeepseek] = useState(false)
  const [showWApiToken, setShowWApiToken] = useState(false)
  const [showBirdIdSecret, setShowBirdIdSecret] = useState(false)

  const [deepseekTest, setDeepseekTest] = useState<TestResult>(null)
  const [wapiTest, setWapiTest] = useState<TestResult>(null)

  const [pendingDeepseek, startDeepseekTest] = useTransition()
  const [pendingWapi, startWapiTest] = useTransition()

  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    saveIntegrations,
    null
  )

  const [pairingPhone, setPairingPhone] = useState(
    (clinicPhone ?? "").replace(/\D/g, "")
  )
  const [pairingResult, setPairingResult] = useState<ConnectResult | null>(null)
  const [qrResult, setQrResult] = useState<ConnectResult | null>(null)
  const [pendingPairing, startPairing] = useTransition()
  const [pendingQr, startQr] = useTransition()

  const [connectionStatus, setConnectionStatus] =
    useState<ConnectResult | null>(null)
  const [pendingStatus, startStatusCheck] = useTransition()

  function handlePairing() {
    setPairingResult(null)
    setWapiTest(null)
    startPairing(async () => {
      const result = await generatePairingCode(pairingPhone)
      setPairingResult(result)
      if (result.success) runStatusCheck()
    })
  }

  function handleQr() {
    setQrResult(null)
    setWapiTest(null)
    startQr(async () => {
      const result = await generateQrCode()
      setQrResult(result)
      if (result.success) runStatusCheck()
    })
  }

  function runStatusCheck() {
    startStatusCheck(async () => {
      const result = await checkWhatsAppConnection()
      setConnectionStatus(result)
    })
  }

  async function handleCopyWebhook() {
    // Fallback para navegadores sem Clipboard API em contexto não seguro (HTTP).
    async function legacyCopy() {
      const textarea = document.createElement("textarea")
      textarea.value = webhookUrl
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
        await navigator.clipboard.writeText(webhookUrl)
      } else {
        await legacyCopy()
      }
      toast.success("Endereço do webhook copiado")
    } catch {
      toast.error("Não foi possível copiar — selecione o endereço manualmente")
    }
  }

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message)
      router.refresh()
    } else if (state && !state.success) {
      toast.error(state.message)
    }
  }, [state, router])

  // Ao abrir a página (ou depois de salvar credenciais), já verifica o
  // status da conexão do WhatsApp.
  useEffect(() => {
    if (initial.wApiInstance && initial.wApiToken) {
      runStatusCheck()
    } else {
      setConnectionStatus(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.wApiInstance, initial.wApiToken])

  // Enquanto o QR/código de pareamento estiver na tela, re-verifica o status
  // a cada 10s — assim que o celular concluir a conexão, o badge muda para
  // "Conectada" sozinho e a verificação para.
  useEffect(() => {
    if (
      (!qrResult?.success && !pairingResult?.success) ||
      connectionStatus?.connected
    ) {
      return
    }
    const interval = setInterval(runStatusCheck, 10_000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrResult?.success, pairingResult?.success, connectionStatus?.connected])

  // Conectou: limpa o QR/código antigos e qualquer erro de teste pendente,
  // para não deixar mensagens desatualizadas na tela.
  useEffect(() => {
    if (connectionStatus?.connected) {
      setQrResult(null)
      setPairingResult(null)
      setWapiTest(null)
    }
  }, [connectionStatus?.connected])

  function handleTest(service: "deepseek" | "wapi") {
    setDeepseekTest(null)
    setWapiTest(null)

    if (service === "deepseek") {
      startDeepseekTest(async () => {
        const result = await testIntegration({
          service,
          deepseekApiKey: deepseekKey,
        })
        setDeepseekTest(result)
      })
      return
    }

    startWapiTest(async () => {
      const result = await testIntegration({
        service,
        wApiInstance,
        wApiToken,
      })
      setWapiTest(result)
    })
  }

  const deepseekConfigured = !!initial.deepseekApiKey
  const wapiConfigured = !!(initial.wApiInstance && initial.wApiToken)
  const birdIdConfigured = !!(initial.birdIdClientId && initial.birdIdClientSecretSet)

  const statusBadge = !wapiConfigured ? (
    <Badge variant="outline">Sem credenciais</Badge>
  ) : !connectionStatus ? (
    <Badge variant="outline">Verificando...</Badge>
  ) : connectionStatus.connected ? (
    <Badge className="bg-green-600 text-white hover:bg-green-600">
      Conectada
    </Badge>
  ) : connectionStatus.success ? (
    <Badge variant="destructive">Desconectada</Badge>
  ) : (
    <Badge variant="outline">Status indisponível</Badge>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrações</CardTitle>
        <CardDescription>
          Serviços externos usados pelo sistema: IA (DeepSeek), WhatsApp
          (W-API) e Bird ID (assinatura em nuvem). As credenciais ficam
          guardadas no banco da clínica.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
<Tabs defaultValue="deepseek">
<TabsList className="max-w-full overflow-x-auto">
<TabsTrigger value="deepseek">IA (DeepSeek)</TabsTrigger>
<TabsTrigger value="birdid">Bird ID</TabsTrigger>
<TabsTrigger value="whatsapp">WhatsApp (W-API)</TabsTrigger>
</TabsList>

{/* ===== DeepSeek ===== */}
<TabsContent value="deepseek" keepMounted className="pt-4">
          <div className="flex flex-col gap-4 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-medium">
                <Bot className="h-4 w-4 text-primary" />
                DeepSeek (IA)
              </div>
              <Badge variant={deepseekConfigured ? "secondary" : "outline"}>
                {deepseekConfigured ? "Configurada" : "Não configurada"}
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              Usada para gerar o resumo do plano terapêutico com IA. Crie a
              chave em platform.deepseek.com (menu API Keys).
            </p>

            <Field>
              <FieldLabel>Chave da API</FieldLabel>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    name="deepseekApiKey"
                    type={showDeepseek ? "text" : "password"}
                    value={deepseekKey}
                    onChange={(event) => {
                      setDeepseekKey(event.target.value)
                      setDeepseekTest(null)
                    }}
                    placeholder="sk-..."
                    autoComplete="off"
                    className="pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDeepseek((value) => !value)}
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={
                      showDeepseek ? "Ocultar chave" : "Mostrar chave"
                    }
                  >
                    {showDeepseek ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleTest("deepseek")}
                  disabled={pendingDeepseek || !deepseekKey.trim()}
                >
                  {pendingDeepseek ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="h-4 w-4" />
                  )}
                  Testar chave
                </Button>
              </div>
            </Field>

            {deepseekTest && (
              <p
                className={
                  deepseekTest.success
                    ? "text-sm text-green-600 dark:text-green-400"
                    : "text-sm text-destructive"
                }
              >
                {deepseekTest.message}
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Sem chave, o médico escreve o resumo do plano manualmente — o
              sistema continua funcionando.
            </p>
          </div>
</TabsContent>

{/* ===== Bird ID (assinatura em nuvem) ===== */}
<TabsContent value="birdid" keepMounted className="pt-4">
          <div className="flex flex-col gap-4 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-medium">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Bird ID (assinatura em nuvem)
              </div>
              <Badge variant={birdIdConfigured ? "secondary" : "outline"}>
                {birdIdConfigured ? "Configurada" : "Não configurada"}
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              Certificado digital em nuvem (ICP-Brasil) usado para assinar
              prescrições e planos terapêuticos. As credenciais da aplicação
              vêm do console do Bird ID (Wings); o client secret é guardado
              criptografado e não volta a aparecer depois de salvo.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>Ambiente</FieldLabel>
                <select
                  name="birdIdBaseUrl"
                  value={birdIdBaseUrl}
                  onChange={(event) => setBirdIdBaseUrl(event.target.value)}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="https://apihom.birdid.com.br">
                    Homologação (apihom.birdid.com.br)
                  </option>
                  <option value="https://api.birdid.com.br">
                    Produção (api.birdid.com.br)
                  </option>
                </select>
              </Field>

              <Field>
                <FieldLabel>Client ID</FieldLabel>
                <Input
                  name="birdIdClientId"
                  value={birdIdClientId}
                  onChange={(event) => setBirdIdClientId(event.target.value)}
                  placeholder="Client ID da aplicação no console Bird ID"
                  autoComplete="off"
                />
              </Field>
            </div>

            <Field>
              <FieldLabel>Client secret</FieldLabel>
              <div className="relative">
                <Input
                  name="birdIdClientSecret"
                  type={showBirdIdSecret ? "text" : "password"}
                  value={birdIdClientSecret}
                  onChange={(event) => setBirdIdClientSecret(event.target.value)}
                  placeholder={
                    initial.birdIdClientSecretSet
                      ? "Salvo — preencha apenas para substituir"
                      : "Client secret da aplicação"
                  }
                  autoComplete="new-password"
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowBirdIdSecret((value) => !value)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={
                    showBirdIdSecret ? "Ocultar secret" : "Mostrar secret"
                  }
                >
                  {showBirdIdSecret ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </Field>

            <p className="text-xs text-muted-foreground">
              Sem credenciais, a conexão Bird ID aparece como não configurada
              para os médicos (a assinatura A1 .pfx continua funcionando).
              Para assinar por sessão sem push, o Wings precisa liberar o
              escopo signature_session (OAuth Password).
            </p>
          </div>
</TabsContent>

{/* ===== WhatsApp (W-API) ===== */}
<TabsContent value="whatsapp" keepMounted className="pt-4">
          <div className="flex flex-col gap-4 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-medium">
                <MessageCircle className="h-4 w-4 text-primary" />
                WhatsApp (W-API)
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Badge variant={wapiConfigured ? "secondary" : "outline"}>
                  {wapiConfigured ? "Configurada" : "Não configurada"}
                </Badge>
                {statusBadge}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Envio de mensagens, PDFs e validação de números. Salve as
              credenciais e conecte o número da clínica aqui mesmo — sem
              W-API, o sistema usa o modo simulação.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>ID da instância</FieldLabel>
                <Input
                  name="wApiInstance"
                  value={wApiInstance}
                  onChange={(event) => {
                    setWApiInstance(event.target.value)
                    setWapiTest(null)
                  }}
                  placeholder="T34398-VYR3QD-MS29SL"
                  autoComplete="off"
                />
              </Field>

              <Field>
                <FieldLabel>Token</FieldLabel>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      name="wApiToken"
                      type={showWApiToken ? "text" : "password"}
                      value={wApiToken}
                      onChange={(event) => {
                        setWApiToken(event.target.value)
                        setWapiTest(null)
                      }}
                      placeholder="Token da instância"
                      autoComplete="off"
                      className="pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowWApiToken((value) => !value)}
                      className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={
                        showWApiToken ? "Ocultar token" : "Mostrar token"
                      }
                    >
                      {showWApiToken ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleTest("wapi")}
                    disabled={
                      pendingWapi || !wApiInstance.trim() || !wApiToken.trim()
                    }
                  >
                    {pendingWapi ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MessageCircle className="h-4 w-4" />
                    )}
                    Testar conexão
                  </Button>
                </div>
              </Field>
            </div>

            {wapiTest && (
              <p
                className={
                  wapiTest.success
                    ? "text-sm text-green-600 dark:text-green-400"
                    : "text-sm text-destructive"
                }
              >
                {wapiTest.message}
              </p>
            )}

            {/* Status da conexão */}
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">Status da conexão</p>
                <p
                  className={
                    connectionStatus && !connectionStatus.success
                      ? "text-xs text-destructive"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {connectionStatus?.message ??
                    "Informa se o número da clínica está conectado ao WhatsApp."}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={runStatusCheck}
                disabled={pendingStatus || !wapiConfigured}
              >
                {pendingStatus ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Verificar status
              </Button>
            </div>

            {/* ===== Conectar WhatsApp ===== */}
            <div className="flex flex-col gap-4 rounded-lg border p-4">
              <div className="flex items-center gap-2 font-medium">
                <QrCode className="h-4 w-4 text-primary" />
                Conectar WhatsApp
              </div>
              <p className="text-xs text-muted-foreground">
                Conecte o número da clínica pelo código de pareamento (mais
                fácil) ou pelo QR code.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {/* Conexão por código */}
                <div className="flex flex-col gap-3 rounded-md border p-3">
                  <p className="text-sm font-medium">
                    Por código (recomendado)
                  </p>
                  <Field>
                    <FieldLabel>Número do WhatsApp da clínica</FieldLabel>
                    <Input
                      value={pairingPhone}
                      onChange={(event) => {
                        setPairingPhone(event.target.value)
                        setPairingResult(null)
                      }}
                      placeholder="5594999999999"
                      inputMode="numeric"
                      autoComplete="off"
                    />
                    <p className="text-xs text-muted-foreground">
                      Com DDI e DDD, só números (ex.: 5594999999999)
                    </p>
                  </Field>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePairing}
                    disabled={pendingPairing || !pairingPhone.trim()}
                  >
                    {pendingPairing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Phone className="h-4 w-4" />
                    )}
                    Gerar código de pareamento
                  </Button>

                  {pairingResult &&
                    (pairingResult.success ? (
                      <div className="flex flex-col gap-2">
                        <p className="text-sm text-green-600 dark:text-green-400">
                          {pairingResult.message}
                        </p>
                        <div className="rounded-md border bg-muted px-3 py-2 text-center font-mono text-2xl tracking-widest">
                          {pairingResult.pairingCode}
                        </div>
                        <ol className="list-decimal pl-4 text-xs text-muted-foreground">
                          <li>
                            No celular, abra o WhatsApp e toque em
                            Configurações/Ajustes.
                          </li>
                          <li>
                            Toque em &quot;Aparelhos conectados&quot; e depois
                            em &quot;Conectar aparelho&quot;.
                          </li>
                          <li>
                            Escolha &quot;Conectar com número de telefone&quot;
                            e digite o código acima.
                          </li>
                        </ol>
                      </div>
                    ) : (
                      <p className="text-sm text-destructive">
                        {pairingResult.message}
                      </p>
                    ))}
                </div>

                {/* Conexão por QR code */}
                <div className="flex flex-col gap-3 rounded-md border p-3">
                  <p className="text-sm font-medium">Por QR code</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleQr}
                    disabled={pendingQr}
                  >
                    {pendingQr ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <QrCode className="h-4 w-4" />
                    )}
                    Gerar QR code
                  </Button>

                  {qrResult &&
                    (qrResult.success ? (
                      <div className="flex flex-col gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={qrResult.qrcode}
                          alt="QR code de conexão do WhatsApp"
                          className="mx-auto h-52 w-52 rounded-md border"
                        />
                        <p className="text-xs text-muted-foreground">
                          No celular: WhatsApp → Configurações → Aparelhos
                          conectados → Conectar aparelho → escaneie o código.
                          Ele expira em cerca de 20 segundos — se expirar,
                          clique em &quot;Gerar QR code&quot; de novo.
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-destructive">
                        {qrResult.message}
                      </p>
                    ))}
                </div>
              </div>
            </div>

            {/* ===== Webhook (mensagens recebidas) ===== */}
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex items-center gap-2 font-medium">
                <Webhook className="h-4 w-4 text-primary" />
                Webhook — mensagens recebidas
              </div>
              <p className="text-xs text-muted-foreground">
                Para o bot responder sozinho, o painel da W-API precisa
                avisar o sistema quando chega mensagem. Na W-API, em
                Webhook, cole o endereço abaixo no campo{" "}
                <b>Ao receber uma mensagem</b>. Os demais campos podem
                ficar em branco.
              </p>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={webhookUrl}
                  onFocus={(event) => event.target.select()}
                  className="flex-1 font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCopyWebhook}
                >
                  <Copy className="h-4 w-4" />
                  Copiar
                </Button>
              </div>
            </div>
          </div>
</TabsContent>
</Tabs>

          <div className="flex gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar integrações"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
