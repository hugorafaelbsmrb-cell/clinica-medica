/**
 * Encerramento de cobranças pendentes junto com seus lançamentos.
 *
 * Arquivo separado (fora do router.ts) de propósito: o router importa as
 * automações de WhatsApp e as automações importam este módulo — mantê-lo
 * aqui evita import circular.
 */
import { prisma } from "@/lib/prisma"

/**
 * Cancela uma cobrança pendente e solta o vínculo com o lançamento
 * financeiro (a entry é mantida para gerar uma nova cobrança depois).
 * Usado quando o meio de pagamento muda e uma nova cobrança será criada.
 */
export async function cancelPendingPayment(
  paymentId: string,
  motivo: string
): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (!payment || payment.status !== "PENDENTE") return

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "CANCELADO", financialEntryId: null },
  })

  await prisma.auditLog.create({
    data: {
      action: "UPDATE",
      entity: "Payment",
      entityId: payment.id,
      patientId: payment.patientId ?? undefined,
      details: { status: "CANCELADO", motivo },
    },
  })
}

/**
 * Cancela uma cobrança pendente e remove o lançamento PENDENTE criado pelo
 * sistema junto com ela (agendamento online, acompanhamento, cobrança
 * avulsa). Como nunca foi pago, a entry é excluída para não inflar
 * "a receber"/inadimplência depois do cancelamento.
 */
export async function cancelPendingPaymentAndEntry(
  paymentId: string,
  motivo: string
): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { financialEntry: { select: { status: true } } },
  })
  if (!payment || payment.status !== "PENDENTE") return

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: "CANCELADO" },
    }),
    // Só remove se a entry continuar PENDENTE (nunca paga manualmente).
    ...(payment.financialEntryId &&
    payment.financialEntry?.status === "PENDENTE"
      ? [
          prisma.financialEntry.delete({
            where: { id: payment.financialEntryId },
          }),
        ]
      : []),
  ])

  await prisma.auditLog.create({
    data: {
      action: "UPDATE",
      entity: "Payment",
      entityId: payment.id,
      patientId: payment.patientId ?? undefined,
      details: {
        status: "CANCELADO",
        motivo,
        entryRemovida: !!payment.financialEntryId,
      },
    },
  })
}
