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
  saveIntegrations,
  testIntegration,
  type ActionState,
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
                  {wapiConfigured ? "Conectada" : "Não configurada"}
                </Badge>
              </div>

              <p className="text-xs text-muted-foreground">
                Envio de mensagens, PDFs e validação de números. As
                credenciais ficam no painel da W-API (w-api.app) — aba
                Instância, botão &quot;Autenticar&quot; para conectar o WhatsApp.
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
