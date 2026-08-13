import Link from "next/link"
import type { Metadata } from "next"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Plus, ClipboardList, Sparkles } from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
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

export const metadata: Metadata = { title: "Planos terapêuticos" }

const STATUS_LABELS = {
  RASCUNHO: "Rascunho",
  GERADO: "Gerado por IA",
  APROVADO: "Aprovado",
} as const

export default async function PlanosPage() {
  const session = await auth()
  requireRole(session, ["ADMIN", "MEDICO"])

  const plans = await prisma.therapeuticPlan.findMany({
    include: { patient: true, doctor: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Planos terapêuticos
          </h1>
          <p className="text-muted-foreground">
            Diagnóstico, metas e resumo do tratamento por paciente
          </p>
        </div>
        <Button render={<Link href="/planos-terapeuticos/novo" />}>
          <Plus className="h-4 w-4" />
          Novo plano
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Planos recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {plans.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
              <ClipboardList className="h-10 w-10" />
              <p>Nenhum plano terapêutico registrado ainda</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Diagnóstico</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Atualizado</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((plan) => (
                  <TableRow key={plan.id}>
                    <TableCell>
                      <Link
                        href={`/pacientes/${plan.patientId}`}
                        className="font-medium hover:underline"
                      >
                        {plan.patient.name}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-64 truncate">
                      {plan.diagnosis}
                    </TableCell>
                    <TableCell>
                      {plan.source === "IA" ? (
                        <Badge variant="secondary">
                          <Sparkles className="mr-1 h-3 w-3" />
                          IA
                        </Badge>
                      ) : (
                        <Badge variant="outline">Manual</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          plan.status === "APROVADO" ? "default" : "outline"
                        }
                      >
                        {STATUS_LABELS[plan.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(plan.updatedAt, "dd/MM/yyyy", { locale: ptBR })}
                    </TableCell>
                    <TableCell className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        render={
                          <Link href={`/planos-terapeuticos/${plan.id}`} />
                        }
                      >
                        Ver
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        render={
                          <Link
                            href={`/planos-terapeuticos/${plan.id}/editar`}
                          />
                        }
                      >
                        Editar
                      </Button>
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
