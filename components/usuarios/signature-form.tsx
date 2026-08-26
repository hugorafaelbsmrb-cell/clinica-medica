"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ImagePlus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { updateMySignature, type ActionState } from "@/lib/actions/usuarios"

export type SignatureInitialData = {
  name: string
  crm: string | null
  signatureText: string | null
  signatureImage: string | null
}

const MAX_SIGNATURE_BYTES = 500 * 1024 // 500 KB

/**
 * Autoatendimento: o médico cadastra a própria assinatura virtual
 * (imagem) com texto de fallback e CRM.
 */
export function SignatureForm({ initial }: { initial: SignatureInitialData }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  function handleSignatureSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    const isAllowed =
      file.type === "image/png" ||
      file.type === "image/jpeg" ||
      file.type === "image/jpg"
    if (!isAllowed) {
      toast.error("Use uma imagem PNG ou JPEG")
      return
    }
    if (file.size > MAX_SIGNATURE_BYTES) {
      toast.error("Assinatura muito grande — use uma imagem de até 500 KB")
      return
    }

    const reader = new FileReader()
    reader.onload = () => setSignatureImage(String(reader.result))
    reader.readAsDataURL(file)
  }

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
            <FieldLabel>Imagem da assinatura</FieldLabel>
            <div className="flex flex-wrap items-center gap-4">
              {signatureImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={signatureImage}
                  alt="Sua assinatura"
                  className="h-14 w-56 rounded-lg border bg-background object-contain p-1"
                />
              ) : (
                <div className="flex h-14 w-56 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
                  <ImagePlus className="h-6 w-6" />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={handleSignatureSelected}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus className="h-4 w-4" />
                    Escolher imagem
                  </Button>
                  {signatureImage && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSignatureImage("")}
                    >
                      <Trash2 className="h-4 w-4" />
                      Remover
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  PNG ou JPEG, até 500 KB. Assine em um papel branco, fotografe
                  e envie — a imagem substitui o texto nos documentos.
                </p>
              </div>
            </div>
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
