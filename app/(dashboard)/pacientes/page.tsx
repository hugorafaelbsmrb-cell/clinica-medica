import Link from "next/link"
import type { Metadata } from "next"
import { Eye, Pencil, Plus, Search, Users } from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { DeletePatientButton } from "./delete-patient-button"
import { CadastroLinkButton } from "@/components/pacientes/cadastro-link-button"

export const metadata: Metadata = { title: "Pacientes" }

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; bairro?: string }>
}) {
  const session = await auth()
  requireRole(session, ["ADMIN", "MEDICO", "SECRETARIA"])

  const { q, bairro } = await searchParams

  const where = {
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { cpf: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(bairro
      ? { neighborhood: { contains: bairro, mode: "insensitive" as const } }
      : {}),
  }

  const [patients, total, neighborhoods] = await Promise.all([
    prisma.patient.findMany({
      where,
      orderBy: { name: "asc" },
      take: 100,
    }),
    prisma.patient.count(),
    prisma.patient.groupBy({
      by: ["neighborhood"],
      where: { neighborhood: { not: null } },
      _count: true,
      orderBy: { _count: { neighborhood: "desc" } },
      take: 15,
    }),
  ])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pacientes</h1>
          <p className="text-muted-foreground">
            {total} paciente{total === 1 ? "" : "s"} cadastrado{total === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CadastroLinkButton />
          <Button render={<Link href="/pacientes/novo" />}>
            <Plus className="h-4 w-4" />
            Novo paciente
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <form className="flex w-full max-w-sm items-center gap-2" action="/pacientes">
          <Input name="q" defaultValue={q ?? ""} placeholder="Buscar por nome ou CPF..." />
          <Button type="submit" variant="outline" size="icon">
            <Search className="h-4 w-4" />
          </Button>
        </form>
        <form className="flex items-center gap-2" action="/pacientes">
          <select
            name="bairro"
            defaultValue={bairro ?? ""}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">Todos os bairros</option>
            {neighborhoods.map((n) => (
              <option key={n.neighborhood} value={n.neighborhood ?? ""}>
                {n.neighborhood}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline">
            Filtrar
          </Button>
        </form>
        {(q || bairro) && (
          <Button variant="link" render={<Link href="/pacientes" />}>
            Limpar filtros
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lista de pacientes</CardTitle>
        </CardHeader>
        <CardContent>
          {patients.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
              <Users className="h-10 w-10" />
              <p>Nenhum paciente encontrado</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead className="hidden lg:table-cell">CPF</TableHead>
                  <TableHead className="hidden md:table-cell">Telefone</TableHead>
                  <TableHead className="hidden lg:table-cell">Bairro</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {patients.map((patient) => (
                  <TableRow key={patient.id}>
                    <TableCell>
                      <Link
                        href={`/pacientes/${patient.id}`}
                        className="font-medium hover:underline"
                      >
                        {patient.name}
                      </Link>
                      {patient.registeredVia === "ONLINE" && (
                        <Badge variant="outline" className="ml-2">
                          Online
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {patient.cpf ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {patient.phone ?? "—"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {patient.neighborhood ?? "—"}
                    </TableCell>
                    <TableCell>
                      {patient.whatsappEnabled ? (
                        <Badge variant="secondary">Ativo</Badge>
                      ) : (
                        <Badge variant="outline">Inativo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        render={<Link href={`/pacientes/${patient.id}`} />}
                      >
                        <Eye className="h-4 w-4 sm:hidden" />
                        <span className="hidden sm:inline">Ver</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        render={<Link href={`/pacientes/${patient.id}/editar`} />}
                      >
                        <Pencil className="h-4 w-4 sm:hidden" />
                        <span className="hidden sm:inline">Editar</span>
                      </Button>
                      <DeletePatientButton patientId={patient.id} name={patient.name} />
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
