import Link from "next/link"
import type { Metadata } from "next"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Eye, FileText, Plus, Printer } from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const metadata: Metadata = { title: "Prescrições" }

export default async function PrescricoesPage() {
  const session = await auth()
  requireRole(session, ["ADMIN", "MEDICO"])

  const prescriptions = await prisma.prescription.findMany({
    include: { patient: true, doctor: true, items: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Prescrições</h1>
          <p className="text-muted-foreground">
            Histórico de receitas médicas
          </p>
        </div>
        <Button render={<Link href="/prescricoes/novo" />}>
          <Plus className="h-4 w-4" />
          Nova prescrição
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prescrições recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {prescriptions.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
              <FileText className="h-10 w-10" />
              <p>Nenhuma prescrição registrada ainda</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Paciente</TableHead>
                  <TableHead className="hidden md:table-cell">Médico</TableHead>
                  <TableHead className="hidden sm:table-cell">Medicamentos</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prescriptions.map((prescription) => (
                  <TableRow key={prescription.id}>
                    <TableCell>
                      {format(prescription.createdAt, "dd/MM/yyyy", { locale: ptBR })}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/pacientes/${prescription.patientId}`}
                        className="font-medium hover:underline"
                      >
                        {prescription.patient.name}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {prescription.doctor?.name ?? "—"}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {prescription.items
                        .map((item) => item.medication)
                        .join(", ")}
                    </TableCell>
                    <TableCell className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        render={<Link href={`/prescricoes/${prescription.id}`} />}
                      >
                        <Eye className="h-4 w-4 sm:hidden" />
                        <span className="hidden sm:inline">Ver</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        render={
                          <Link href={`/prescricoes/${prescription.id}/imprimir`} />
                        }
                      >
                        <Printer className="h-4 w-4 sm:hidden" />
                        <span className="hidden sm:inline">Imprimir</span>
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
