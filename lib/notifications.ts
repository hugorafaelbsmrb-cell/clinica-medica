/**
 * Notificações internas da clínica (sino no topo do painel).
 * São globais: valem para toda a equipe logada. Os gatilhos atuais são
 * consultas agendadas (pelo site ou pela equipe), consultas confirmadas
 * por pagamento e pedidos de atendente no bot do WhatsApp.
 */
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { prisma } from "@/lib/prisma"
import { dispatchPush } from "@/lib/push"

const TYPE_LABELS: Record<string, string> = {
  PRESENCIAL: "Presencial",
  DOMICILIAR: "Domiciliar",
  TELECONSULTA: "Teleconsulta",
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

/** Cria a notificação no painel e dispara o push para os celulares. */
async function createAndDispatch(data: {
  type: "NOVA_CONSULTA" | "CONSULTA_CONFIRMADA" | "ATENDENTE"
  title: string
  body: string
  link: string
  attendanceId?: string
  patientId?: string
}): Promise<void> {
  const created = await prisma.notification.create({ data })

  // Push não bloqueia o fluxo: roda em segundo plano e nunca lança erro
  dispatchPush({
    title: created.title,
    body: created.body ?? undefined,
    url: created.link ?? "/dashboard",
    notificationId: created.id,
  }).catch((error) => console.error("[Push] Erro no envio:", error))
}

/**
 * Nova consulta agendada (agendamento online ou pela equipe).
 * `awaitingPayment` marca a reserva que ainda depende de pagamento.
 */
export async function notifyNewAppointment(
  attendanceId: string,
  awaitingPayment = false
): Promise<void> {
  const attendance = await prisma.attendance.findUnique({
    where: { id: attendanceId },
    include: { patient: { select: { name: true } } },
  })
  if (!attendance) return

  const when = format(attendance.scheduledAt, "dd/MM 'às' HH:mm", {
    locale: ptBR,
  })

  await createAndDispatch({
    type: "NOVA_CONSULTA",
    title: awaitingPayment ? "Nova reserva de consulta" : "Nova consulta agendada",
    body: `${attendance.patient.name} — ${typeLabel(attendance.type)} em ${when}${
      awaitingPayment ? " (aguardando pagamento)" : ""
    }`,
    link: `/atendimentos/${attendance.id}`,
    attendanceId: attendance.id,
    patientId: attendance.patientId,
  })
}

/** Reserva confirmada quando o pagamento cai (webhook do gateway). */
export async function notifyAppointmentConfirmed(
  attendanceId: string
): Promise<void> {
  const attendance = await prisma.attendance.findUnique({
    where: { id: attendanceId },
    include: { patient: { select: { name: true } } },
  })
  if (!attendance) return

  const when = format(attendance.scheduledAt, "dd/MM 'às' HH:mm", {
    locale: ptBR,
  })

  await createAndDispatch({
    type: "CONSULTA_CONFIRMADA",
    title: "Consulta confirmada",
    body: `${attendance.patient.name} — ${typeLabel(attendance.type)} em ${when} (pagamento confirmado)`,
    link: `/atendimentos/${attendance.id}`,
    attendanceId: attendance.id,
    patientId: attendance.patientId,
  })
}

/** Paciente pediu para falar com um humano no bot do WhatsApp. */
export async function notifyAttendantNeeded(
  patientId: string,
  patientName: string,
  messageContent: string
): Promise<void> {
  const snippet =
    messageContent.length > 120
      ? `${messageContent.slice(0, 120).trimEnd()}…`
      : messageContent

  await createAndDispatch({
    type: "ATENDENTE",
    title: "Paciente pediu atendente",
    body: `${patientName}: “${snippet}”`,
    link: "/whatsapp",
    patientId,
  })
}
