import type { Metadata } from "next"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { UserForm } from "@/components/usuarios/usuario-form"

export const metadata: Metadata = { title: "Novo usuário" }

export default async function NovoUsuarioPage() {
  const session = await auth()
  requireRole(session, ["ADMIN"])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Novo usuário</h1>
        <p className="text-muted-foreground">
          Crie um acesso para a equipe e defina o perfil de permissões
        </p>
      </div>
      <UserForm />
    </div>
  )
}
