"use client"

import { useActionState, useEffect, useState } from "react"
import { toast } from "sonner"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { SignatureCanvas } from "@/components/usuarios/signature-canvas"
import { updateMySignature, type ActionState } from "@/lib/actions/usuarios"

export type SignatureInitialData = {
  name: string
  crm: string | null
  meetLink: string | null
  signatureText: string | null
  signatureImage: string | null
}

/**
 * Autoatendimento: o médico cadastra a própria assinatura virtual
 * desenhando na tela (mouse ou dedo) — o desenho vira um PNG com
 * fundo transparente usado nos documentos.
 */
export function SignatureForm({ initial }: { initial: SignatureInitialData }) {
  const [signatureImage, setSignatureImage] = useState(
    initial.signatureImage ?? ""
  )

  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    updateMySignature,
    null
  )

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message)
    } else if (state && !state.success) {
      toast.error(state.message)
    }
  }, [state])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assinatura de {initial.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
          <input type="hidden" name="signatureImage" value={signatureImage} />

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>CRM</FieldLabel>
              <Input
                name="crm"
                defaultValue={initial.crm ?? ""}
                placeholder="CRM/SP 123456"
              />
            </Field>
            <Field>
              <FieldLabel>Assinatura (texto, opcional)</FieldLabel>
              <Input
                name="signatureText"
                defaultValue={initial.signatureText ?? ""}
                placeholder="Dr. Carlos Mendes"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel>Link do Google Meet (teleconsultas)</FieldLabel>
            <Input
              name="meetLink"
              type="url"
              defaultValue={initial.meetLink ?? ""}
              placeholder="https://meet.google.com/xxx-xxxx-xxx"
            />
            <p className="text-xs text-muted-foreground">
              Link padrão enviado ao paciente no dia da sua teleconsulta.
            </p>
          </Field>

          <Field>
            <FieldLabel>Assinatura desenhada</FieldLabel>
            {signatureImage ? (
              <div className="mb-3 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={signatureImage}
                  alt="Sua assinatura"
                  className="h-14 w-56 rounded-lg border bg-background object-contain p-1"
                />
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">
                    Assinatura atual. Desenhe novamente no quadro para
                    substituí-la.
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSignatureImage("")}
                  >
                    <Trash2 className="h-4 w-4" />
                    Apagar assinatura
                  </Button>
                </div>
              </div>
            ) : null}
            <SignatureCanvas
              onChange={(dataUrl) => setSignatureImage(dataUrl ?? "")}
            />
            <p className="text-xs text-muted-foreground">
              O desenho substitui a assinatura atual. Se ficar sem assinatura,
              os documentos usam o texto acima como fallback.
            </p>
          </Field>

          <div className="flex gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar assinatura"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
