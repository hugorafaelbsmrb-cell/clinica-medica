"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Bot,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MessageCircle,
  Phone,
  QrCode,
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
}

type TestResult = { success: boolean; message: string } | null

export function IntegracoesForm({
  initial,
}: {
  initial: IntegrationInitialData
}) {
  const router = useRouter()

  const [deepseekKey, setDeepseekKey] = useState(initial.deepseekApiKey)
  const [wApiInstance, setWApiInstance] = useState(initial.wApiInstance)
  const [wApiToken, setWApiToken] = useState(initial.wApiToken)

  const [showDeepseek, setShowDeepseek] = useState(false)
  const [showWApiToken, setShowWApiToken] = useState(false)

  const [deepseekTest, setDeepseekTest] = useState<TestResult>(null)
  const [wapiTest, setWapiTest] = useState<TestResult>(null)

  const [pendingDeepseek, startDeepseekTest] = useTransition()
  const [pendingWapi, startWapiTest] = useTransition()

  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    saveIntegrations,
    null
  )

  const [pairingPhone, setPairingPhone] = useState("")
  const [pairingResult, setPairingResult] = useState<ConnectResult | null>(null)
  const [qrResult, setQrResult] = useState<ConnectResult | null>(null)
  const [pendingPairing, startPairing] = useTransition()
  const [pendingQr, startQr] = useTransition()

  function handlePairing() {
    setPairingResult(null)
    startPairing(async () => {
      const result = await generatePairingCode(pairingPhone)
      setPairingResult(result)
    })
  }

  function handleQr() {
    setQrResult(null)
    startQr(async () => {
      const result = await generateQrCode()
      setQrResult(result)
    })
  }

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message)
      router.refresh()
    } else if (state && !state.success) {
      toast.error(state.message)
    }
  }, [state, router])

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrações</CardTitle>
        <CardDescription>
          Serviços externos usados pelo sistema: IA (DeepSeek) e WhatsApp
          (W-API). As credenciais ficam guardadas no banco da clínica.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* ===== DeepSeek ===== */}
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

            {/* ===== W-API ===== */}
            <div className="flex flex-col gap-4 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-medium">
                  <MessageCircle className="h-4 w-4 text-primary" />
                  WhatsApp (W-API)
                </div>
                <Badge variant={wapiConfigured ? "secondary" : "outline"}>
                  {wapiConfigured ? "Configurada" : "Não configurada"}
                </Badge>
              </div>

              <p className="text-xs text-muted-foreground">
                Envio de mensagens, PDFs e validação de números. Após salvar as
                credenciais, conecte o número do WhatsApp na seção
                &quot;Conectar WhatsApp&quot; logo abaixo.
              </p>

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

              <p className="text-xs text-muted-foreground">
                Sem W-API, o sistema usa o modo simulação — mensagens não são
                enviadas de verdade.
              </p>
            </div>
          </div>

          {/* ===== Conectar WhatsApp ===== */}
          <div className="flex flex-col gap-4 rounded-lg border p-4">
            <div className="flex items-center gap-2 font-medium">
              <QrCode className="h-4 w-4 text-primary" />
              Conectar WhatsApp
            </div>
            <p className="text-xs text-muted-foreground">
              Depois de salvar as credenciais, conecte o número da clínica aqui
              mesmo — pelo código de pareamento (mais fácil) ou pelo QR code.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {/* Conexão por código */}
              <div className="flex flex-col gap-3 rounded-md border p-3">
                <p className="text-sm font-medium">Por código (recomendado)</p>
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
                          Toque em &quot;Aparelhos conectados&quot; e depois em
                          &quot;Conectar aparelho&quot;.
                        </li>
                        <li>
                          Escolha &quot;Conectar com número de telefone&quot; e
                          digite o código acima.
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
                        Ele expira em cerca de 20 segundos — se expirar, clique
                        em &quot;Gerar QR code&quot; de novo.
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
