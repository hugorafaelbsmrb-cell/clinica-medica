import { redirect } from "next/navigation"
import type { Metadata } from "next"
import { auth } from "@/lib/auth"
import { getClinicSettings } from "@/lib/clinic"
import { LoginForm } from "./login-form"

export const metadata: Metadata = {
  title: "Entrar",
}

export default async function LoginPage() {
  const session = await auth()
  if (session) redirect("/dashboard")

  const clinic = await getClinicSettings()

  return (
    <main className="flex min-h-screen flex-col bg-background md:flex-row">
      {/* Metade da tela: imagem com a frase sobre o Home Care */}
      <section className="relative flex h-48 shrink-0 flex-col justify-end overflow-hidden md:h-auto md:min-h-screen md:w-1/2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/login-homecare.jpg"
          alt="Profissional de saúde realizando atendimento domiciliar Home Care"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/15" />
        <div className="relative flex flex-col gap-2 p-6 text-white md:p-12">
          <p className="text-xl font-bold leading-snug md:text-3xl">
            Cuidar de quem você ama, sem sair de casa.
          </p>
          <p className="text-sm font-medium text-white/90 md:text-lg">
            Atendimento Home Care: nossa equipe leva saúde, carinho e segurança
            até a porta da sua casa.
          </p>
        </div>
      </section>

      {/* Outra metade: formulário de login com a logo do sistema */}
      <section className="flex flex-1 items-center justify-center bg-muted/40 p-6 md:w-1/2">
        <LoginForm logoDataUrl={clinic.logoDataUrl} clinicName={clinic.name} />
      </section>
    </main>
  )
}
