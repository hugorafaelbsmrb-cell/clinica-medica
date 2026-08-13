import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { ArrowLeft } from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { Button } from "@/components/ui/button"
import { UserForm } from "@/components/usuarios/usuario-form"

export const metadata: Metadata = { title: "Editar usuário" }

export default async function EditarUsuarioPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  requireRole(session, ["ADMIN"])

  const { id } = await params

  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) notFound()

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          render={<Link href="/usuarios" />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Editar usuário
          </h1>
          <p className="text-muted-foreground">
            {user.name} — {user.email}
          </p>
        </div>
      </div>
      <UserForm
        initial={{
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          crm: user.crm,
          signatureText: user.signatureText,
        }}
      />
    </div>
  )
}
