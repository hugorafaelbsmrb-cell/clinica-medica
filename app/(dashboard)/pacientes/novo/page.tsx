import type { Metadata } from "next"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { PatientForm } from "@/components/pacientes/paciente-form"

export const metadata: Metadata = { title: "Novo paciente" }

export default async function NovoPacientePage() {
  const session = await auth()
  requireRole(session, ["ADMIN", "MEDICO", "SECRETARIA"])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Novo paciente</h1>
        <p className="text-muted-foreground">
          Preencha os dados do paciente. O consentimento LGPD é obrigatório
          para habilitar as mensagens automáticas de WhatsApp.
        </p>
      </div>
      <PatientForm />
    </div>
  )
}
