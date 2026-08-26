"use client"

/**
 * Certificado digital A1 (ICP-Brasil) do médico — upload/remoção.
 * O .pfx/.p12 e a senha são validados no upload e armazenados
 * criptografados no banco (AES-256-GCM).
 */
import { useActionState, useEffect, useState } from "react"
import { toast } from "sonner"
import { BadgeCheck, FileKey2, Trash2, TriangleAlert } from "lucide-react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  uploadMyCertificate,
  removeMyCertificate,
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
  clinicEnabled: boolean
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
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message)
    } else if (state && !state.success) {
      toast.error(state.message)
    }
  }, [state])

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

  return (
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
  )
}
