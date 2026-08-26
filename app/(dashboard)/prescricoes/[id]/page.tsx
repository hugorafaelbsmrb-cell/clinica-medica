import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Printer, ArrowLeft, Download } from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { getClinicSettings } from "@/lib/clinic"
import { getActiveCertificate } from "@/lib/signing/certificate"
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

export const metadata: Metadata = { title: "Prescrição" }

export default async function PrescricaoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  requireRole(session, ["ADMIN", "MEDICO"])

  const { id } = await params

  const prescription = await prisma.prescription.findUnique({
    where: { id },
    include: {
      patient: true,
      doctor: true,
      attendance: { include: { patient: true } },
      items: { orderBy: { id: "asc" } },
    },
  })

  if (!prescription) notFound()

  // Download assinado disponível quando a clínica habilitou a assinatura
  // digital e o médico tem certificado A1 válido.
  const [clinic, certificate] = await Promise.all([
    getClinicSettings(),
    getActiveCertificate(prescription.doctorId),
  ])
  const canSign = (clinic.enableDigitalSignature ?? false) && Boolean(certificate)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            render={<Link href="/prescricoes" />}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Prescrição médica
            </h1>
            <p className="text-muted-foreground">
              {format(prescription.createdAt, "dd 'de' MMMM 'de' yyyy", {
                locale: ptBR,
              })}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {canSign && (
            <Button
              render={
                <a href={`/api/prescricoes/${prescription.id}/pdf`} />
              }
            >
              <Download className="h-4 w-4" />
              Baixar PDF assinado
            </Button>
          )}
          <Button
            variant="outline"
            render={
              <Link href={`/prescricoes/${prescription.id}/imprimir`} />
            }
          >
            <Printer className="h-4 w-4" />
            Imprimir / PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Paciente</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <Link
            href={`/pacientes/${prescription.patientId}`}
            className="text-base font-medium hover:underline"
          >
            {prescription.patient.name}
          </Link>
          {prescription.patient.birthDate && (
            <span className="text-muted-foreground">
              Nascimento:{" "}
              {format(prescription.patient.birthDate, "dd/MM/yyyy", {
                locale: ptBR,
              })}
            </span>
          )}
          {prescription.patient.phone && (
            <span className="text-muted-foreground">
              Telefone: {prescription.patient.phone}
            </span>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Médico responsável</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div>
              <p className="font-medium">{prescription.doctor?.name ?? "—"}</p>
              {prescription.doctor?.crm && (
                <p className="text-muted-foreground">{prescription.doctor.crm}</p>
              )}
            </div>
            {prescription.doctor?.signatureImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={prescription.doctor.signatureImage}
                alt="Assinatura do médico"
                className="h-14 w-48 rounded-md border bg-background object-contain p-1"
              />
            ) : (
              prescription.doctor?.signatureText && (
                <p className="font-serif text-lg italic text-muted-foreground">
                  {prescription.doctor.signatureText}
                </p>
              )
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Atendimento</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-2 text-sm">
            {prescription.attendance ? (
              <Link
                href={`/atendimentos/${prescription.attendanceId}`}
                className="hover:underline"
              >
                {format(
                  prescription.attendance.scheduledAt,
                  "dd/MM/yyyy",
                  { locale: ptBR }
                )}{" "}
                — {prescription.attendance.type === "PRESENCIAL" ? "Presencial" : "Domiciliar"}
              </Link>
            ) : (
              <span className="text-muted-foreground">Sem vínculo</span>
            )}
            {prescription.attendance && (
              <Badge variant="outline">
                {prescription.attendance.status === "REALIZADO"
                  ? "Realizado"
                  : prescription.attendance.status === "CANCELADO"
                    ? "Cancelado"
                    : "Agendado"}
              </Badge>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Medicamentos prescritos</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Medicamento</TableHead>
                <TableHead>Dose</TableHead>
                <TableHead>Frequência</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead>Orientações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prescription.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    {item.medication}
                  </TableCell>
                  <TableCell>{item.dosage ?? "—"}</TableCell>
                  <TableCell>{item.frequency ?? "—"}</TableCell>
                  <TableCell>{item.duration ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.instructions ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
