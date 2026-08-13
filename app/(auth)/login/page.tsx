import { redirect } from "next/navigation"
import type { Metadata } from "next"
import {
  CalendarDays,
  DollarSign,
  FileText,
  HeartPulse,
  MessageCircle,
} from "lucide-react"
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
      {/* Metade da tela: imagem com o resumo das funcionalidades */}
      <section className="relative flex h-72 shrink-0 flex-col justify-center overflow-hidden md:h-auto md:min-h-screen md:w-1/2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/login-cover.jpg"
          alt="Profissional de saúde realizando atendimento Home Care"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/85 via-black/65 to-black/45" />
        <div className="relative flex flex-col items-start gap-3 p-5 text-left text-white md:p-10">
          <p className="text-lg font-bold leading-snug md:text-2xl">
            Tudo o que sua clínica precisa, em um só lugar
          </p>
          <ul className="flex flex-col gap-1.5 text-xs font-medium text-white/95 md:gap-2.5 md:text-base">
            <li className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 shrink-0 md:h-5 md:w-5" />
              Agendamento online de consultas
            </li>
            <li className="flex items-center gap-2">
              <HeartPulse className="h-4 w-4 shrink-0 md:h-5 md:w-5" />
              Atendimento Home Care
            </li>
            <li className="flex items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 md:h-5 md:w-5" />
              Prescrições e planos terapêuticos
            </li>
            <li className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 shrink-0 md:h-5 md:w-5" />
              Comunicação por WhatsApp
            </li>
            <li className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 shrink-0 md:h-5 md:w-5" />
              Controle financeiro da clínica
            </li>
          </ul>
        </div>
      </section>

      {/* Outra metade: formulário de login com a logo do sistema */}
      <section className="flex flex-1 items-center justify-center bg-muted/40 p-6 md:w-1/2">
        <LoginForm logoDataUrl={clinic.logoDataUrl} clinicName={clinic.name} />
      </section>
    </main>
  )
}
