import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { HeartPulse } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getClinicSettings } from "@/lib/clinic"
import {
  PagamentoPublicoForm,
  type PagamentoPublicoData,
} from "@/components/pagamento/pagamento-publico-form"

export const metadata: Metadata = { title: "Pagamento" }

// Dinâmica: busca a cobrança no banco a cada requisição e não depende do
// banco no momento do build (evita falha de deploy).
export const dynamic = "force-dynamic"

/**
 * Página pública de pagamento (acessada pelo link enviado ao paciente):
 * PIX com QR code + copia-e-cola e cartão de crédito processado de forma
 * transparente, direto no sistema — sem checkout hospedado do gateway.
 * A chave da página é o id da cobrança (aleatório e não sequencial).
 */
export default async function PagarPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const payment = await prisma.payment.findUnique({
    where: { id: token },
    include: {
      attendance: { select: { scheduledAt: true } },
      patient: { select: { name: true, zipCode: true } },
    },
  })
  if (!payment) notFound()

  const clinic = await getClinicSettings()

  const data: PagamentoPublicoData = {
    token: payment.id,
    method: payment.method,
    amount: Number(payment.amount),
    status: payment.status,
    mock: payment.provider === "MOCK",
    pixQrCodeUrl: payment.pixQrCodeUrl,
    pixCopiaCola: payment.pixCopiaCola,
    checkoutUrl: payment.checkoutUrl,
    scheduledAt: payment.attendance?.scheduledAt.toISOString() ?? null,
    patientName: payment.patient?.name ?? null,
    patientZipCode: payment.patient?.zipCode ?? null,
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        {clinic.logoDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={clinic.logoDataUrl}
            alt={clinic.name}
            className="h-20 w-20 rounded-full border bg-background object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
            <HeartPulse className="h-10 w-10 text-primary" />
          </div>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{clinic.name}</h1>
        <p className="text-lg text-muted-foreground">Pagamento online</p>
      </div>

      <PagamentoPublicoForm data={data} />

      <p className="mt-6 max-w-md text-center text-sm text-muted-foreground">
        Pagamento processado com segurança pelos nossos parceiros Asaas e
        Stripe, direto aqui no sistema.
      </p>
    </main>
  )
}
