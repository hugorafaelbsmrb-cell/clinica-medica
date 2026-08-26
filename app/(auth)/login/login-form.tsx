"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldError } from "@/components/ui/field"
import { Checkbox } from "@/components/ui/checkbox"
import {
  clearCredentials,
  loadCredentials,
  saveCredentials,
} from "@/lib/auth-storage"

const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(1, "Informe a senha"),
})

type LoginValues = z.infer<typeof loginSchema>

type LoginFormProps = {
  logoDataUrl?: string | null
  clinicName?: string | null
}

export function LoginForm({ logoDataUrl, clinicName }: LoginFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [remember, setRemember] = useState(false)
  const autoLoginTried = useRef(false)
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  })

  // Se o usuário marcou "Lembrar de mim", entra automaticamente ao abrir
  useEffect(() => {
    if (autoLoginTried.current) return
    autoLoginTried.current = true

    const saved = loadCredentials()
    if (!saved) return

    setValue("email", saved.email)
    setValue("password", saved.password)
    setLoading(true)

    void (async () => {
      const result = await signIn("credentials", {
        email: saved.email,
        password: saved.password,
        redirect: false,
      })
      if (result?.error) {
        setLoading(false)
        toast.error(
          "Não foi possível entrar automaticamente — confira suas credenciais"
        )
        return
      }
      router.push("/dashboard")
      router.refresh()
    })()
  }, [router, setValue])

  async function onSubmit(values: LoginValues) {
    setLoading(true)
    try {
      const result = await signIn("credentials", {
        email: values.email,
        password: values.password,
        redirect: false,
      })

      if (result?.error) {
        toast.error("E-mail ou senha incorretos")
        return
      }

      // Só persiste no dispositivo quando o usuário optou por lembrar
      if (remember) {
        saveCredentials({ email: values.email, password: values.password })
      } else {
        clearCredentials()
      }

      router.push("/dashboard")
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        {logoDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoDataUrl}
            alt={clinicName ?? "Logo da clínica"}
            className="mx-auto h-20 w-20 object-contain"
          />
        )}
        <CardTitle className="text-2xl">{clinicName ?? "Médico em Domicílio"}</CardTitle>
        <CardDescription>
          Entre com suas credenciais para acessar o sistema
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <Field>
            <Input
              type="email"
              placeholder="E-mail"
              autoComplete="email"
              data-invalid={!!errors.email}
              {...register("email")}
            />
            <FieldError errors={[errors.email]} />
          </Field>
          <Field>
            <Input
              type="password"
              placeholder="Senha"
              autoComplete="current-password"
              data-invalid={!!errors.password}
              {...register("password")}
            />
            <FieldError errors={[errors.password]} />
          </Field>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Entrando..." : "Entrar"}
          </Button>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={remember}
              onCheckedChange={(checked) => setRemember(checked)}
            />
            Lembrar de mim neste dispositivo
          </label>
        </form>
      </CardContent>
    </Card>
  )
}
