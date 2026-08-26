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
    <main className="relative flex min-h-screen flex-col bg-background md:flex-row">
      {/* Imagem: no celular cobre a tela toda como fundo; no desktop é a
          metade esquerda com o resumo das funcionalidades */}
      <section className="absolute inset-0 overflow-hidden md:static md:flex md:min-h-screen md:w-1/2 md:flex-col md:justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/login-cover.jpg"
          alt="Profissional de saúde realizando atendimento Home Care"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/85 via-black/65 to-black/45" />
        {/* Textos do sistema só aparecem no desktop */}
        <div className="relative hidden flex-col items-start gap-3 p-10 text-left text-white md:flex">
          <p className="text-3xl font-bold leading-snug">
            Tudo o que sua clínica precisa, em um só lugar
          </p>
          <ul className="flex flex-col gap-2.5 text-lg font-medium text-white/95">
            <li className="flex items-center gap-2">
              <CalendarDays className="h-6 w-6 shrink-0" />
              Agendamento online de consultas
            </li>
            <li className="flex items-center gap-2">
              <HeartPulse className="h-6 w-6 shrink-0" />
              Atendimento Home Care
            </li>
            <li className="flex items-center gap-2">
              <FileText className="h-6 w-6 shrink-0" />
              Prescrições e planos terapêuticos
            </li>
            <li className="flex items-center gap-2">
              <MessageCircle className="h-6 w-6 shrink-0" />
              Comunicação por WhatsApp
            </li>
            <li className="flex items-center gap-2">
              <DollarSign className="h-6 w-6 shrink-0" />
              Controle financeiro da clínica
            </li>
          </ul>
        </div>
      </section>

      {/* Formulário: sobreposto à imagem no celular; metade direita no desktop */}
      <section className="relative z-10 flex flex-1 items-center justify-center p-6 md:w-1/2 md:bg-muted/40">
        <LoginForm logoDataUrl={clinic.logoDataUrl} clinicName={clinic.name} />
      </section>
    </main>
  )
}
