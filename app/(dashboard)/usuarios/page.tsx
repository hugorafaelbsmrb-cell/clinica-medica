import Link from "next/link"
import type { Metadata } from "next"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Plus, UserCog } from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { ROLE_LABELS } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToggleUserActiveButton } from "./toggle-user-active-button"

export const metadata: Metadata = { title: "Usuários" }

export default async function UsuariosPage() {
  const session = requireRole(await auth(), ["ADMIN"])

  const users = await prisma.user.findMany({
    orderBy: { name: "asc" },
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usuários</h1>
          <p className="text-muted-foreground">
            Controle de acesso da equipe da clínica
          </p>
        </div>
        <Button render={<Link href="/usuarios/novo" />}>
          <Plus className="h-4 w-4" />
          Novo usuário
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Equipe ({users.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
              <UserCog className="h-10 w-10" />
              <p>Nenhum usuário cadastrado</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Perfil</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Criado em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.name}
                      {user.id === session.user.id && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (você)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {ROLE_LABELS[user.role]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.active ? "default" : "secondary"}>
                        {user.active ? "Ativo" : "Desativado"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(user.createdAt, "dd/MM/yyyy", { locale: ptBR })}
                    </TableCell>
                    <TableCell className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        render={<Link href={`/usuarios/${user.id}/editar`} />}
                      >
                        Editar
                      </Button>
                      <ToggleUserActiveButton
                        userId={user.id}
                        active={user.active}
                        isSelf={user.id === session.user.id}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
