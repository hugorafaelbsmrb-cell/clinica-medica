import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { getClinicSettings } from "@/lib/clinic"
import { prisma } from "@/lib/prisma"
import { PrintButton } from "@/components/prescricoes/print-button"

export const metadata: Metadata = { title: "Imprimir prescrição" }

// Página fora do grupo (dashboard): renderiza sem sidebar,
// em layout limpo, pronto para impressão / salvar como PDF.
export default async function PrescricaoImprimirPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  requireRole(session, ["ADMIN", "MEDICO"])

  const { id } = await params

  const [clinic, prescription] = await Promise.all([
    getClinicSettings(),
    prisma.prescription.findUnique({
      where: { id },
      include: {
        patient: true,
        doctor: true,
        items: { orderBy: { id: "asc" } },
      },
    }),
  ])

  if (!prescription) notFound()

  return (
    <div className="min-h-screen bg-muted/40 p-6 md:p-10 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex justify-end print:hidden">
          <PrintButton />
        </div>

        <div className="rounded-lg border bg-background p-8 shadow-sm print:rounded-none print:border-0 print:shadow-none">
          {/* Cabeçalho da clínica */}
          <div className="mb-8 flex items-start justify-between gap-4 border-b border-dashed pb-6">
            <div className="flex items-start gap-3">
              {clinic.logoDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={clinic.logoDataUrl}
                  alt={`Logo ${clinic.name}`}
                  className="h-14 w-14 rounded-md object-contain"
                />
              )}
              <div>
                <h1 className="text-xl font-bold tracking-tight">
                  {clinic.name}
                </h1>
                {clinic.address && (
                  <p className="text-xs text-muted-foreground">
                    {clinic.address}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {[clinic.phone, clinic.email].filter(Boolean).join(" • ")}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold">Prescrição médica</p>
              <p className="text-sm text-muted-foreground">
                Emitida em{" "}
                {format(prescription.createdAt, "dd/MM/yyyy 'às' HH:mm", {
                  locale: ptBR,
                })}
              </p>
            </div>
          </div>

          {/* Dados do paciente */}
          <div className="mb-8">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Paciente
            </h2>
            <p className="text-lg font-medium">{prescription.patient.name}</p>
            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
              {prescription.patient.birthDate && (
                <span>
                  Nascimento:{" "}
                  {format(prescription.patient.birthDate, "dd/MM/yyyy", {
                    locale: ptBR,
                  })}
                </span>
              )}
              {prescription.patient.phone && (
                <span>Telefone: {prescription.patient.phone}</span>
              )}
              {prescription.patient.cpf && (
                <span>CPF: {prescription.patient.cpf}</span>
              )}
            </div>
          </div>

          {/* Medicamentos */}
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Medicamentos
          </h2>
          <table className="mb-8 w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Medicamento</th>
                <th className="py-2 pr-2 font-medium">Dose</th>
                <th className="py-2 pr-2 font-medium">Frequência</th>
                <th className="py-2 pr-2 font-medium">Duração</th>
                <th className="py-2 font-medium">Orientações</th>
              </tr>
            </thead>
            <tbody>
              {prescription.items.map((item) => (
                <tr key={item.id} className="border-b border-dashed">
                  <td className="py-2 pr-2 font-medium">{item.medication}</td>
                  <td className="py-2 pr-2">{item.dosage ?? "—"}</td>
                  <td className="py-2 pr-2">{item.frequency ?? "—"}</td>
                  <td className="py-2 pr-2">{item.duration ?? "—"}</td>
                  <td className="py-2">{item.instructions ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Assinatura */}
          <div className="mt-16 flex items-end justify-between">
            <div className="w-64">
              <div className="min-h-8 border-t pt-2">
                {(prescription.doctor?.signatureText ?? prescription.doctor?.name) && (
                  <p className="text-center font-serif text-lg italic">
                    {prescription.doctor?.signatureText ?? prescription.doctor?.name}
                  </p>
                )}
              </div>
              <p className="text-center text-sm text-muted-foreground">
                Assinatura do médico
              </p>
            </div>
            <div className="text-right text-sm text-muted-foreground">
              {prescription.doctor?.name && (
                <p className="font-medium text-foreground">
                  {prescription.doctor.name}
                </p>
              )}
              {prescription.doctor?.crm && <p>{prescription.doctor.crm}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
