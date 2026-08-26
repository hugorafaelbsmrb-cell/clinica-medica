"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ImagePlus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  createUser,
  updateUser,
  type ActionState,
} from "@/lib/actions/usuarios"

export type UserInitialData = {
  id?: string
  name?: string
  email?: string
  role?: string
  crm?: string | null
  signatureText?: string | null
  signatureImage?: string | null
}

const ROLES = [
  { value: "ADMIN", label: "Administrador" },
  { value: "MEDICO", label: "Médico" },
  { value: "SECRETARIA", label: "Secretária/Recepção" },
  { value: "FINANCEIRO", label: "Financeiro" },
]

const MAX_SIGNATURE_BYTES = 500 * 1024 // 500 KB

export function UserForm({ initial }: { initial?: UserInitialData }) {
  const router = useRouter()
  const isEditing = Boolean(initial?.id)
  const action = isEditing ? updateUser : createUser
  const [role, setRole] = useState(initial?.role ?? "SECRETARIA")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [signatureImage, setSignatureImage] = useState(
    initial?.signatureImage ?? ""
  )

  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    action,
    null
  )

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message)
      router.push("/usuarios")
    } else if (state && !state.success) {
      toast.error(state.message)
    }
  }, [state, router])

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
        <CardTitle>{isEditing ? "Editar usuário" : "Novo usuário"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
          {isEditing && <input type="hidden" name="id" value={initial!.id} />}
          <input type="hidden" name="signatureImage" value={signatureImage} />

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Nome *</FieldLabel>
              <Input
                name="name"
                required
                minLength={3}
                defaultValue={initial?.name ?? ""}
                placeholder="Nome completo"
              />
            </Field>
            <Field>
              <FieldLabel>E-mail *</FieldLabel>
              <Input
                name="email"
                type="email"
                required
                defaultValue={initial?.email ?? ""}
                placeholder="usuario@clinica.com"
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Perfil *</FieldLabel>
              <select
                name="role"
                required
                value={role}
                onChange={(event) => setRole(event.target.value)}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                {ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel>
                {isEditing ? "Nova senha (opcional)" : "Senha *"}
              </FieldLabel>
              <Input
                name="password"
                type="password"
                required={!isEditing}
                minLength={6}
                placeholder={
                  isEditing
                    ? "Deixe vazio para manter a atual"
                    : "Mínimo 6 caracteres"
                }
              />
            </Field>
          </div>

          {role === "MEDICO" && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>CRM</FieldLabel>
                  <Input
                    name="crm"
                    defaultValue={initial?.crm ?? ""}
                    placeholder="CRM/SP 123456"
                  />
                </Field>
                <Field>
                  <FieldLabel>Assinatura (texto, opcional)</FieldLabel>
                  <Input
                    name="signatureText"
                    defaultValue={initial?.signatureText ?? ""}
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
                      alt="Assinatura do médico"
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
                      PNG ou JPEG, até 500 KB. Se preenchida, substitui o texto
                      nas prescrições, planos e prontuários.
                    </p>
                  </div>
                </div>
              </Field>
              <p className="text-xs text-muted-foreground -mt-2">
                O CRM e a assinatura aparecem automaticamente nas prescrições e
                planos terapêuticos (PDFs e impressão).
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar usuário"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={pending}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
