import type { Metadata } from "next"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { EntryForm } from "@/components/financeiro/entrada-form"

export const metadata: Metadata = { title: "Novo lançamento" }

export default async function NovoFinanceiroPage() {
  const session = await auth()
  requireRole(session, ["ADMIN", "FINANCEIRO"])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Novo lançamento
        </h1>
        <p className="text-muted-foreground">
          Registre uma receita ou despesa da clínica
        </p>
      </div>
      <EntryForm />
    </div>
  )
}
