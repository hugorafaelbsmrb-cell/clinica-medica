import type { Metadata } from "next"
import { HeartPulse } from "lucide-react"
import { getClinicSettings } from "@/lib/clinic"
import { CadastroWizard } from "@/components/cadastro/cadastro-wizard"

export const metadata: Metadata = {
  title: "Cadastro de paciente",
  description: "Pré-cadastro de paciente para atendimento na clínica",
}

// Dinâmica: busca os dados da clínica no banco a cada requisição e não
// depende do banco no momento do build (evita falha de deploy no Render).
export const dynamic = "force-dynamic"

/**
 * Página pública de pré-cadastro (autoatendimento).
 * O link pode ser enviado ao paciente no primeiro contato.
 */
export default async function CadastroPage() {
  const clinic = await getClinicSettings()

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        {clinic.logoDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={clinic.logoDataUrl}
            alt={clinic.name}
            className="h-20 w-20 rounded-full border bg-background object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
            <HeartPulse className="h-10 w-10 text-primary" />
          </div>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{clinic.name}</h1>
        <p className="text-lg text-muted-foreground">Pré-cadastro de paciente</p>
      </div>

      <CadastroWizard />

      <p className="mt-6 max-w-md text-center text-sm text-muted-foreground">
        Seus dados são protegidos conforme a Lei Geral de Proteção de Dados
        (LGPD) e usados apenas para o seu atendimento.
      </p>
    </main>
  )
}
