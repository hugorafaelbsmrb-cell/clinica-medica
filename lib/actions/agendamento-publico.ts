"use server"

/**
 * Ações públicas de agendamento (sem sessão), usadas pelo wizard /cadastro
 * e pela página de consultas do paciente (/cancelar/[token]):
 * - lookupPatientByCpf: reconhece paciente existente pelo CPF;
 * - getPublicAgenda: lista dias e horários livres;
 * - agendarPublico: confirma o agendamento (cria o Attendance);
 * - getConsultasPublicas: última consulta + próxima consulta do paciente;
 * - remarcarConsultaPublica: altera dia/horário pelo token público;
 * - cancelarConsultaPublica: cancelamento pelo link enviado na confirmação.
 */
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { groupSlotsByDay } from "@/lib/agenda/slots"
import { getAvailableSlots, isSlotFree } from "@/lib/agenda/service"
import { queueAppointmentConfirmation } from "@/lib/whatsapp/message-service"
import { getAppointmentSettings } from "@/lib/agenda/service"

const WEEKDAY_LABELS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
]

const MONTH_LABELS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
]

export type LookupCpfResult = {
  found: boolean
  patientId?: string
  name?: string
  lgpdConsent?: boolean
  message?: string
}

/**
 * Busca paciente pelo CPF para pular direto para o agendamento.
 * Retorna apenas o primeiro nome e a indicação de consentimento (LGPD).
 */
export async function lookupPatientByCpf(cpf: string): Promise<LookupCpfResult> {
  const digits = cpf.replace(/\D/g, "")
  if (digits.length !== 11) {
    return { found: false, message: "Informe um CPF válido com 11 números." }
  }

  const formatted = `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(
    6,
    9
  )}-${digits.slice(9)}`

  const patient = await prisma.patient.findFirst({
    where: { cpf: { in: [digits, formatted] } },
    select: { id: true, name: true, lgpdConsent: true },
  })

  if (!patient) {
    return {
      found: false,
      message:
        "Não encontramos um cadastro com este CPF. Continue seu cadastro normalmente — seu CPF já está preenchido.",
    }
  }

  return {
    found: true,
    patientId: patient.id,
    name: patient.name.split(" ")[0],
    lgpdConsent: patient.lgpdConsent,
  }
}

export type PublicAgendaDay = {
  date: string // "yyyy-mm-dd"
  label: string // "quinta-feira, 15 de maio"
  slots: { iso: string; time: string }[]
}

export type PublicAgendaResult = {
  available: boolean
  message: string
  days: PublicAgendaDay[]
}

/** Lista os dias com vagas livres dentro do horizonte de agendamento. */
export async function getPublicAgenda(): Promise<PublicAgendaResult> {
  const settings = await getAppointmentSettings()
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const to = new Date(from)
  to.setDate(to.getDate() + settings.maxAdvanceDays)

  const { slots } = await getAvailableSlots(from, to)

  if (slots.length === 0) {
    return {
      available: false,
      message:
        "A clínica ainda não liberou horários. Fique tranquilo: sua equipe entrará em contato para agendar.",
      days: [],
    }
  }

  const days = groupSlotsByDay(slots).map(({ date, slots: daySlots }) => ({
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(date.getDate()).padStart(2, "0")}`,
    label: `${WEEKDAY_LABELS[date.getDay()]}, ${date.getDate()} de ${
      MONTH_LABELS[date.getMonth()]
    }`,
    slots: daySlots.map((s) => ({
      iso: s.toISOString(),
      time: `${String(s.getHours()).padStart(2, "0")}:${String(
        s.getMinutes()
      ).padStart(2, "0")}`,
    })),
  }))

  return { available: true, message: "", days }
}

const agendarSchema = z.object({
  patientId: z.string().min(1),
  scheduledAt: z.string().min(1),
  reason: z
    .string()
    .trim()
    .min(5, "Conte brevemente o motivo da sua consulta"),
  lgpdConsent: z.boolean().optional(),
})

export type AgendarState = {
  success: boolean
  message: string
  scheduledAt?: string
}

/**
 * Confirma o agendamento público: re-checa o horário e cria o Attendance
 * com origin ONLINE. Enfileira a confirmação por WhatsApp quando permitido.
 */
export async function agendarPublico(
  input: z.infer<typeof agendarSchema>
): Promise<AgendarState> {
  const parsed = agendarSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }

  const { patientId, scheduledAt: scheduledAtIso, reason } = parsed.data
  const scheduledAt = new Date(scheduledAtIso)
  if (Number.isNaN(scheduledAt.getTime())) {
    return { success: false, message: "Data e horário inválidos." }
  }

  const patient = await prisma.patient.findUnique({ where: { id: patientId } })
  if (!patient) {
    return {
      success: false,
      message:
        "Cadastro não encontrado. Refaça o cadastro ou fale com a clínica.",
    }
  }

  try {
    // Re-checa se o horário continua livre antes de confirmar
    const free = await isSlotFree(scheduledAt)
    if (!free) {
      return {
        success: false,
        message:
          "Este horário acabou de ser preenchido. Escolha outro horário, por favor.",
      }
    }

    const attendance = await prisma.$transaction(async (tx) => {
      // Proteção contra corrida: re-checagem dentro da transação
      const conflict = await tx.attendance.findFirst({
        where: { scheduledAt, status: { not: "CANCELADO" } },
      })
      if (conflict) return null

      const created = await tx.attendance.create({
        data: {
          patientId,
          scheduledAt,
          status: "AGENDADO",
          type: "PRESENCIAL",
          origin: "ONLINE",
          slotNote: reason,
          cancelToken: crypto.randomUUID().replaceAll("-", ""),
        },
      })

      // Guarda o motivo no cadastro se ainda não havia um
      if (!patient.consultationReason) {
        await tx.patient.update({
          where: { id: patientId },
          data: { consultationReason: reason },
        })
      }

      // Registra o consentimento LGPD, se informado agora
      if (parsed.data.lgpdConsent && !patient.lgpdConsent) {
        await tx.patient.update({
          where: { id: patientId },
          data: { lgpdConsent: true, lgpdConsentAt: new Date() },
        })
      }

      await tx.auditLog.create({
        data: {
          action: "CREATE",
          entity: "Attendance",
          entityId: created.id,
          patientId,
          details: {
            origem: "agendamento online",
            data: scheduledAt.toISOString(),
          },
        },
      })

      return created
    })

    if (!attendance) {
      return {
        success: false,
        message:
          "Este horário acabou de ser preenchido. Escolha outro horário, por favor.",
      }
    }

    // Confirmação por WhatsApp (o próprio serviço checa consentimento)
    if (patient.lgpdConsent || parsed.data.lgpdConsent) {
      await queueAppointmentConfirmation(patientId, {
        id: attendance.id,
        scheduledAt,
        cancelToken: attendance.cancelToken,
      })
    }

    return {
      success: true,
      message: "Consulta agendada!",
      scheduledAt: scheduledAt.toISOString(),
    }
  } catch (error) {
    console.error("[AgendamentoOnline] Erro ao agendar:", error)
    return {
      success: false,
      message:
        "Não foi possível confirmar o agendamento agora. Tente novamente ou fale com a clínica.",
    }
  }
}

export type CancelState = {
  success: boolean
  alreadyCancelled?: boolean
  message: string
}

export type ConsultaResumo = {
  id: string
  scheduledAt: string // ISO
  status: "AGENDADO" | "REALIZADO" | "CANCELADO"
  origin: string
  slotNote: string | null
  cancelToken: string
}

export type ConsultasPublicasResult = {
  found: boolean
  firstName: string
  next: ConsultaResumo | null
  last: ConsultaResumo | null
}

const resumoDe = (a: {
  id: string
  scheduledAt: Date
  status: string
  origin: string
  slotNote: string | null
  cancelToken: string | null
}): ConsultaResumo => ({
  id: a.id,
  scheduledAt: a.scheduledAt.toISOString(),
  status: a.status as ConsultaResumo["status"],
  origin: a.origin,
  slotNote: a.slotNote,
  cancelToken: a.cancelToken ?? "",
})

/**
 * Resumo das consultas do paciente a partir do token público do link:
 * a próxima consulta agendada (se houver) e a última consulta anterior.
 * O paciente usa o link tanto para conferir data/hora quanto para remarcar.
 */
export async function getConsultasPublicas(
  token: string
): Promise<ConsultasPublicasResult> {
  if (!token) return { found: false, firstName: "", next: null, last: null }

  const link = await prisma.attendance.findUnique({
    where: { cancelToken: token },
    include: { patient: { select: { id: true, name: true } } },
  })
  if (!link) return { found: false, firstName: "", next: null, last: null }

  const patientId = link.patient.id
  const now = new Date()

  const [next, last] = await Promise.all([
    prisma.attendance.findFirst({
      where: { patientId, status: "AGENDADO", scheduledAt: { gt: now } },
      orderBy: { scheduledAt: "asc" },
    }),
    prisma.attendance.findFirst({
      where: { patientId, scheduledAt: { lt: now } },
      orderBy: { scheduledAt: "desc" },
    }),
  ])

  return {
    found: true,
    firstName: link.patient.name.split(" ")[0],
    next: next ? resumoDe(next) : null,
    last: last ? resumoDe(last) : null,
  }
}

const remarcarSchema = z.object({
  token: z.string().min(1),
  scheduledAt: z.string().min(1),
})

export type RemarcarState = {
  success: boolean
  message: string
  scheduledAt?: string
}

/**
 * Remarca a consulta (novo dia/horário) pelo token público.
 * Re-checa o slot livre em transação e reenvia a confirmação por WhatsApp.
 */
export async function remarcarConsultaPublica(
  input: z.infer<typeof remarcarSchema>
): Promise<RemarcarState> {
  const parsed = remarcarSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, message: "Dados inválidos para remarcar." }
  }

  const attendance = await prisma.attendance.findUnique({
    where: { cancelToken: parsed.data.token },
    include: { patient: { select: { id: true, lgpdConsent: true } } },
  })
  if (!attendance) {
    return {
      success: false,
      message:
        "Consulta não encontrada. Se precisar de ajuda, fale com a clínica.",
    }
  }
  if (attendance.status !== "AGENDADO") {
    return {
      success: false,
      message: "Esta consulta não está mais agendada e não pode ser remarcada.",
    }
  }

  const newSlot = new Date(parsed.data.scheduledAt)
  if (Number.isNaN(newSlot.getTime())) {
    return { success: false, message: "Data e horário inválidos." }
  }
  if (newSlot.getTime() === attendance.scheduledAt.getTime()) {
    return {
      success: false,
      message: "Escolha um horário diferente do atual.",
    }
  }

  try {
    // isSlotFree valida regras, exceções, antecedência e horários ocupados
    const free = await isSlotFree(newSlot)
    if (!free) {
      return {
        success: false,
        message:
          "Este horário não está disponível. Escolha outro horário, por favor.",
      }
    }

    const conflict = await prisma.$transaction(async (tx) => {
      // Proteção contra corrida: re-checagem dentro da transação
      const ocupado = await tx.attendance.findFirst({
        where: { scheduledAt: newSlot, status: { not: "CANCELADO" } },
      })
      if (ocupado) return true

      await tx.attendance.update({
        where: { id: attendance.id },
        data: { scheduledAt: newSlot },
      })

      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          entity: "Attendance",
          entityId: attendance.id,
          patientId: attendance.patientId,
          details: {
            remarcado: {
              de: attendance.scheduledAt.toISOString(),
              para: newSlot.toISOString(),
            },
            origem: "remarcação pública",
          },
        },
      })

      return false
    })

    if (conflict) {
      return {
        success: false,
        message:
          "Este horário acabou de ser preenchido. Escolha outro horário, por favor.",
      }
    }

    // Reenvia a confirmação com o novo horário (o serviço checa o consentimento)
    await queueAppointmentConfirmation(attendance.patientId, {
      id: attendance.id,
      scheduledAt: newSlot,
      cancelToken: attendance.cancelToken ?? "",
    })

    return {
      success: true,
      message: "Consulta remarcada com sucesso!",
      scheduledAt: newSlot.toISOString(),
    }
  } catch (error) {
    console.error("[AgendamentoOnline] Erro ao remarcar:", error)
    return {
      success: false,
      message:
        "Não foi possível remarcar agora. Tente novamente ou fale com a clínica.",
    }
  }
}

/** Cancela uma consulta pelo token público enviado na confirmação. */
export async function cancelarConsultaPublica(
  token: string
): Promise<CancelState> {
  if (!token) return { success: false, message: "Link de cancelamento inválido." }

  const attendance = await prisma.attendance.findUnique({
    where: { cancelToken: token },
  })
  if (!attendance) {
    return {
      success: false,
      message:
        "Consulta não encontrada. Se precisar de ajuda, fale com a clínica.",
    }
  }

  if (attendance.status === "CANCELADO") {
    return {
      success: true,
      alreadyCancelled: true,
      message: "Esta consulta já foi cancelada.",
    }
  }

  const settings = await getAppointmentSettings()
  const hoursUntil =
    (attendance.scheduledAt.getTime() - Date.now()) / (60 * 60 * 1000)
  if (hoursUntil <= settings.cancelLimitHours) {
    return {
      success: false,
      message:
        "Não é mais possível cancelar por aqui, pois a consulta está muito próxima. Fale com a clínica.",
    }
  }

  await prisma.attendance.update({
    where: { id: attendance.id },
    data: { status: "CANCELADO" },
  })

  await prisma.auditLog.create({
    data: {
      action: "UPDATE",
      entity: "Attendance",
      entityId: attendance.id,
      patientId: attendance.patientId,
      details: { status: "CANCELADO", origem: "cancelamento público" },
    },
  })

  return {
    success: true,
    message: "Consulta cancelada. O horário foi liberado para outros pacientes.",
  }
}
