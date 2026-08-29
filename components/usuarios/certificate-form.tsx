"use client"

/**
 * Certificado digital ICP-Brasil do médico — A1 (.pfx) e/ou em nuvem
 * Bird ID (assinatura por push, com precedência sobre o A1).
 * O .pfx/.p12 e a senha são validados no upload e armazenados
 * criptografados no banco (AES-256-GCM); o certificado Bird ID é
 * conectado via OAuth2 e guardado da mesma forma.
 */
import { useActionState, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  BadgeCheck,
  Cloud,
  FileKey2,
  KeyRound,
  Trash2,
  TriangleAlert,
  Unplug,
} from "lucide-react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  closeBirdIdSession,
  disconnectMyBirdId,
  openBirdIdSession,
  removeMyCertificate,
  uploadMyCertificate,
  type CertActionState,
} from "@/lib/actions/certificados"

export type CertificateInitialData = {
  active: {
    subject: string
    issuer: string
    serialNumber: string | null
    validFrom: Date
    validTo: Date
  } | null
  birdId: {
    subject: string
    issuer: string
    serialNumber: string | null
    validFrom: Date
    validTo: Date
    cpf: string
    alias: string
  } | null
  birdIdSession: {
    expiresAt: Date
    lastUsedAt: Date | null
  } | null
  birdIdConfigured: boolean
  clinicEnabled: boolean
  notice?: { type: "success" | "error"; message: string } | null
}

export function CertificateForm({
  initial,
}: {
  initial: CertificateInitialData
}) {
  const [state, formAction, pending] = useActionState<CertActionState | null, FormData>(
    uploadMyCertificate,
    null
  )
  const [sessionState, sessionAction, sessionPending] = useActionState<
    CertActionState | null,
    FormData
  >(openBirdIdSession, null)
  const [removing, setRemoving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [closingSession, setClosingSession] = useState(false)
  const [cpf, setCpf] = useState("")

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message)
    } else if (state && !state.success) {
      toast.error(state.message)
    }
  }, [state])

  useEffect(() => {
    if (sessionState?.success) {
      toast.success(sessionState.message)
    } else if (sessionState && !sessionState.success) {
      toast.error(sessionState.message)
    }
  }, [sessionState])

  // Toast do resultado do onboarding OAuth (?birdid=ok|erro na URL).
  // O ref evita disparar de novo quando a página é revalidada (server
  // actions chamam revalidatePath com os mesmos searchParams no servidor).
  const shownNotice = useRef<string | null>(null)
  useEffect(() => {
    const notice = initial.notice
    if (!notice) return
    const key = `${notice.type}:${notice.message}`
    if (shownNotice.current === key) return
    shownNotice.current = key
    if (notice.type === "success") toast.success(notice.message)
    else toast.error(notice.message)
    // Limpa ?birdid=... da URL (mantém a página limpa ao recarregar).
    window.history.replaceState({}, "", window.location.pathname)
  }, [initial.notice])

  async function handleRemove() {
    if (!confirm("Remover o certificado digital ativo?")) return
    setRemoving(true)
    try {
      const result = await removeMyCertificate()
      if (result.success) toast.success(result.message)
      else toast.error(result.message)
    } finally {
      setRemoving(false)
    }
  }

  async function handleDisconnectBirdId() {
    if (!confirm("Desconectar o certificado em nuvem Bird ID?")) return
    setDisconnecting(true)
    try {
      const result = await disconnectMyBirdId()
      if (result.success) toast.success(result.message)
      else toast.error(result.message)
    } finally {
      setDisconnecting(false)
    }
  }

  async function handleCloseSession() {
    if (!confirm("Encerrar a sessão de assinatura Bird ID?")) return
    setClosingSession(true)
    try {
      const result = await closeBirdIdSession()
      if (result.success) toast.success(result.message)
      else toast.error(result.message)
    } finally {
      setClosingSession(false)
    }
  }

  // O link de conexão só habilita com 11 dígitos (o servidor também valida).
  const cpfDigits = cpf.replace(/\D/g, "")
  const cpfReady = cpfDigits.length === 11

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Certificado em nuvem — Bird ID</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {initial.birdId ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2 rounded-md border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/40">
                <div className="flex items-center gap-2">
                  <BadgeCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
                  <p className="text-sm font-medium">Certificado em nuvem conectado</p>
                </div>
                <p className="text-sm">{initial.birdId.subject}</p>
                <p className="text-xs text-muted-foreground">
                  Alias no Bird ID: {initial.birdId.alias} · CPF: {initial.birdId.cpf}
                </p>
                <p className="text-xs text-muted-foreground">
                  Emitido por: {initial.birdId.issuer}
                </p>
                <p className="text-xs text-muted-foreground">
                  Válido de{" "}
                  {format(initial.birdId.validFrom, "dd/MM/yyyy", { locale: ptBR })}{" "}
                  até{" "}
                  {format(initial.birdId.validTo, "dd/MM/yyyy", { locale: ptBR })}
                </p>
              </div>

              <div className="flex flex-col gap-3 rounded-md border p-4">
                <p className="text-sm font-medium">Sessão de assinatura</p>
                {initial.birdIdSession ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-2 rounded-md border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/40">
                      <div className="flex items-center gap-2">
                        <KeyRound className="h-5 w-5 text-green-600 dark:text-green-400" />
                        <p className="text-sm font-medium">Sessão ativa</p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Ativa até{" "}
                        {format(initial.birdIdSession.expiresAt, "dd/MM/yyyy HH:mm", {
                          locale: ptBR,
                        })}
                        {" "}
                        — os PDFs saem assinados automaticamente, sem push no
                        celular.
                      </p>
                      {initial.birdIdSession.lastUsedAt && (
                        <p className="text-xs text-muted-foreground">
                          Última assinatura:{" "}
                          {format(initial.birdIdSession.lastUsedAt, "dd/MM/yyyy HH:mm", {
                            locale: ptBR,
                          })}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleCloseSession}
                        disabled={closingSession}
                      >
                        <Unplug className="h-4 w-4" />
                        {closingSession ? "Encerrando..." : "Encerrar sessão"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <form action={sessionAction} className="flex flex-col gap-3">
                    <p className="text-xs text-muted-foreground">
                      Abra o app Bird ID e digite o código de 6 dígitos exibido
                      na tela principal (válido por 30 segundos). Enquanto a
                      sessão estiver ativa, as assinaturas saem sem aprovação
                      por push.
                    </p>
                    <Field>
                      <FieldLabel>Código OTP do app</FieldLabel>
                      <Input
                        name="otp"
                        placeholder="000000"
                        inputMode="numeric"
                        maxLength={6}
                        autoComplete="one-time-code"
                        required
                      />
                    </Field>
                    <div className="flex items-center gap-2">
                      <Button type="submit" size="sm" disabled={sessionPending}>
                        <KeyRound className="h-4 w-4" />
                        {sessionPending ? "Abrindo..." : "Abrir sessão de assinatura"}
                      </Button>
                    </div>
                  </form>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                {initial.birdIdSession
                  ? "Sem necessidade de aprovação no app enquanto a sessão estiver ativa."
                  : "Sem sessão ativa, ao baixar uma prescrição ou plano assinado, aprove a solicitação no app do Bird ID."}{" "}
                Se você também tiver um certificado A1, a assinatura em nuvem
                tem precedência.
              </p>

              {!initial.clinicEnabled && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <TriangleAlert className="h-4 w-4 shrink-0" />
                  A assinatura digital está desligada nas configurações da
                  clínica — o administrador precisa ativá-la para os PDFs
                  saírem assinados.
                </p>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleDisconnectBirdId}
                  disabled={disconnecting}
                >
                  <Unplug className="h-4 w-4" />
                  {disconnecting ? "Desconectando..." : "Desconectar Bird ID"}
                </Button>
              </div>
            </div>
          ) : initial.birdIdConfigured ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                Conecte o certificado digital em nuvem do seu Bird ID
                (VaultID): você faz login com seu CPF, autoriza o acesso e a
                cada documento assinado aprova a solicitação no app do Bird
                ID. O certificado A1 continua funcionando normalmente.
              </p>
              <Field>
                <FieldLabel>CPF do titular no Bird ID</FieldLabel>
                <Input
                  value={cpf}
                  onChange={(e) => setCpf(e.target.value)}
                  placeholder="000.000.000-00"
                  inputMode="numeric"
                  maxLength={14}
                  autoComplete="off"
                />
              </Field>
              <div className="flex items-center gap-2">
                {cpfReady ? (
                  <Button
                    render={
                      <a href={`/api/birdid/authorize?cpf=${cpfDigits}`} />
                    }
                  >
                    <Cloud className="h-4 w-4" />
                    Conectar Bird ID
                  </Button>
                ) : (
                  <Button type="button" disabled>
                    <Cloud className="h-4 w-4" />
                    Conectar Bird ID
                  </Button>
                )}
                {!cpfReady && (
                  <span className="text-xs text-muted-foreground">
                    Informe os 11 dígitos do CPF
                  </span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              A conexão Bird ID ainda não foi configurada para esta clínica.
              Enquanto isso, o certificado A1 (.pfx) continua disponível
              abaixo.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
      <CardHeader>
        <CardTitle>Certificado digital (ICP-Brasil)</CardTitle>
      </CardHeader>
      <CardContent>
        {initial.active ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 rounded-md border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/40">
              <div className="flex items-center gap-2">
                <BadgeCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
                <p className="text-sm font-medium">Certificado ativo</p>
              </div>
              <p className="text-sm">{initial.active.subject}</p>
              <p className="text-xs text-muted-foreground">
                Emitido por: {initial.active.issuer}
              </p>
              {initial.active.serialNumber && (
                <p className="text-xs text-muted-foreground">
                  Série: {initial.active.serialNumber}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Válido de{" "}
                {format(initial.active.validFrom, "dd/MM/yyyy", { locale: ptBR })}{" "}
                até{" "}
                {format(initial.active.validTo, "dd/MM/yyyy", { locale: ptBR })}
              </p>
            </div>

            {!initial.clinicEnabled && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <TriangleAlert className="h-4 w-4 shrink-0" />
                A assinatura digital está desligada nas configurações da
                clínica — o administrador precisa ativá-la para os PDFs
                saírem assinados.
              </p>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleRemove}
                disabled={removing}
              >
                <Trash2 className="h-4 w-4" />
                {removing ? "Removendo..." : "Remover certificado"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nenhum certificado cadastrado. Envie o arquivo .pfx/.p12 do seu
            certificado A1 para assinar digitalmente as prescrições e os
            planos terapêuticos.
          </p>
        )}

        <form action={formAction} className="mt-6 flex flex-col gap-4">
          <p className="text-xs font-medium text-muted-foreground">
            {initial.active
              ? "Enviar outro certificado substitui o atual."
              : "Envio do certificado:"}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Arquivo .pfx/.p12</FieldLabel>
              <Input
                type="file"
                name="pfx"
                accept=".pfx,.p12,application/x-pkcs12"
                required
                className="cursor-pointer file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1 file:text-xs file:font-medium file:text-primary-foreground"
              />
            </Field>
            <Field>
              <FieldLabel>Senha do certificado</FieldLabel>
              <Input
                type="password"
                name="password"
                required
                placeholder="Senha do .pfx"
                autoComplete="off"
              />
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={pending}>
              <FileKey2 className="h-4 w-4" />
              {pending ? "Enviando..." : "Ativar certificado"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
    </>
  )
}
