"use server"

/**
 * Ações administrativas da agenda (ADMIN e MEDICO):
 * - saveAvailabilityRules: grade semanal + duração/intervalo globais;
 * - toggleDayBlock / deleteException / saveExtraSlot: exceções por data;
 * - blockSlot: bloqueia um slot específico da visão semanal;
 * - saveAppointmentSettings: regras gerais de agendamento.
 */
import { z } from "zod"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export type AgendaActionState = {
  success: boolean
  message: string
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]

function formatTime(value: FormDataEntryValue | null): string {
  const text = String(value ?? "").trim()
  if (!/^\d{1,2}:\d{2}$/.test(text)) return ""
  const [h, m] = text.split(":").map(Number)
  if (h > 23 || m > 59) return ""
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

async function guard(): Promise<void> {
  const session = await auth()
  const role = session?.user?.role
  if (role !== "ADMIN" && role !== "MEDICO") {
    throw new Error("Sem permissão para alterar a agenda")
  }
}

export async function saveAvailabilityRules(
  _prev: AgendaActionState | null,
  formData: FormData
): Promise<AgendaActionState> {
  try {
    const session = await auth()
    const role = session?.user?.role
    if (role !== "ADMIN" && role !== "MEDICO") {
      throw new Error("Sem permissão para alterar a agenda")
    }

    // ADMIN escolhe o médico no formulário (vazio = grade geral);
    // MEDICO só edita a própria grade.
    let doctorId: string | null =
      String(formData.get("doctorId") ?? "").trim() || null
    if (role === "MEDICO") doctorId = session?.user?.id ?? null
    if (doctorId) {
      const doctor = await prisma.user.findFirst({
        where: { id: doctorId, role: "MEDICO", active: true },
        select: { id: true },
      })
      if (!doctor) {
        return { success: false, message: "O médico selecionado não é válido." }
      }
    }

    const slotDurationRaw = Number(formData.get("slotDurationMin"))
    const bufferRaw = Number(formData.get("bufferMin"))
    const slotDurationMin = Number.isFinite(slotDurationRaw)
      ? Math.min(Math.max(slotDurationRaw, 15), 240)
      : 60
    const bufferMin = Number.isFinite(bufferRaw)
      ? Math.min(Math.max(bufferRaw, 0), 120)
      : 15

    for (const weekday of WEEKDAYS) {
      const active = formData.get(`wd_${weekday}_active`) === "on"
      const startTime = formatTime(formData.get(`wd_${weekday}_start`))
      const endTime = formatTime(formData.get(`wd_${weekday}_end`))

      if (active && (!startTime || !endTime)) {
        return {
          success: false,
          message: "Preencha os horários de início e fim dos dias ativos.",
        }
      }
      if (startTime && endTime && startTime >= endTime) {
        return {
          success: false,
          message: "O horário de fim precisa ser depois do horário de início.",
        }
      }

      const data = {
        startTime: startTime || "08:00",
        endTime: endTime || "17:00",
        slotDurationMin,
        bufferMin,
        active,
      }

      // Sem unique: faz o upsert manual por [doctorId, weekday]
      const existing = await prisma.availabilityRule.findFirst({
        where: { weekday, doctorId },
      })

      if (existing) {
        await prisma.availabilityRule.update({
          where: { id: existing.id },
          data,
        })
      } else if (active) {
        await prisma.availabilityRule.create({
          data: { weekday, doctorId, ...data },
        })
      }
    }

    await prisma.auditLog.create({
      data: {
        action: "UPDATE",
        entity: "AvailabilityRule",
        details: { medicoId: doctorId },
      },
    })

    revalidatePath("/agenda")
    return { success: true, message: "Disponibilidade salva!" }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Sem permissão")) {
      return { success: false, message: error.message }
    }
    console.error("[Agenda] Erro ao salvar disponibilidade:", error)
    return { success: false, message: "Não foi possível salvar a disponibilidade." }
  }
}

/**
 * Alterna o bloqueio de um dia inteiro: cria BLOQUEADO sem faixa ou
 * remove o bloqueio existente.
 */
export async function toggleDayBlock(date: string): Promise<AgendaActionState> {
  try {
    await guard()

    const parsed = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(date)
    if (!parsed.success) return { success: false, message: "Data inválida." }

    const day = new Date(`${parsed.data}T12:00:00`)

    const existing = await prisma.availabilityException.findFirst({
      where: { date: day, type: "BLOQUEADO", startTime: null },
    })

    if (existing) {
      await prisma.availabilityException.delete({ where: { id: existing.id } })
      await prisma.auditLog.create({
        data: {
          action: "DELETE",
          entity: "AvailabilityException",
          entityId: existing.id,
          details: { date: parsed.data, type: "BLOQUEADO" },
        },
      })
      revalidatePath("/agenda")
      return { success: true, message: "Dia desbloqueado." }
    }

    await prisma.availabilityException.create({
      data: { date: day, type: "BLOQUEADO" },
    })
    await prisma.auditLog.create({
      data: {
        action: "CREATE",
        entity: "AvailabilityException",
        details: { date: parsed.data, type: "BLOQUEADO" },
      },
    })
    revalidatePath("/agenda")
    return { success: true, message: "Dia bloqueado." }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Sem permissão")) {
      return { success: false, message: error.message }
    }
    console.error("[Agenda] Erro ao bloquear dia:", error)
    return { success: false, message: "Não foi possível alterar o bloqueio." }
  }
}

export async function deleteException(id: string): Promise<AgendaActionState> {
  try {
    await guard()
    await prisma.availabilityException.delete({ where: { id } })
    await prisma.auditLog.create({
      data: { action: "DELETE", entity: "AvailabilityException", entityId: id },
    })
    revalidatePath("/agenda")
    return { success: true, message: "Exceção removida." }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Sem permissão")) {
      return { success: false, message: error.message }
    }
    console.error("[Agenda] Erro ao remover exceção:", error)
    return { success: false, message: "Não foi possível remover a exceção." }
  }
}

/** Libera uma faixa extra em uma data (ex.: sábado de plantão). */
export async function saveExtraSlot(
  _prev: AgendaActionState | null,
  formData: FormData
): Promise<AgendaActionState> {
  try {
    await guard()

    const date = String(formData.get("date") ?? "")
    const startTime = formatTime(formData.get("startTime"))
    const endTime = formatTime(formData.get("endTime"))

    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date)
    if (!dateOk || !startTime || !endTime) {
      return { success: false, message: "Informe a data e a faixa de horários." }
    }
    if (startTime >= endTime) {
      return { success: false, message: "O horário de fim precisa ser depois do início." }
    }

    await prisma.availabilityException.create({
      data: {
        date: new Date(`${date}T12:00:00`),
        type: "LIVRE",
        startTime,
        endTime,
      },
    })
    await prisma.auditLog.create({
      data: {
        action: "CREATE",
        entity: "AvailabilityException",
        details: { date, type: "LIVRE", startTime, endTime },
      },
    })
    revalidatePath("/agenda")
    return { success: true, message: "Faixa extra liberada!" }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Sem permissão")) {
      return { success: false, message: error.message }
    }
    console.error("[Agenda] Erro ao liberar faixa:", error)
    return { success: false, message: "Não foi possível liberar a faixa." }
  }
}

/** Bloqueia um slot específico da visão semanal (faixa BLOQUEADO com horários). */
export async function blockSlot(input: {
  date: string
  startTime: string
  endTime: string
}): Promise<AgendaActionState> {
  try {
    await guard()

    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(input.date)
    if (!date.success) return { success: false, message: "Data inválida." }

    const startTime = formatTime(input.startTime as unknown as string)
    const endTime = formatTime(input.endTime as unknown as string)
    if (!startTime || !endTime) {
      return { success: false, message: "Horários inválidos." }
    }

    await prisma.availabilityException.create({
      data: {
        date: new Date(`${date.data}T12:00:00`),
        type: "BLOQUEADO",
        startTime,
        endTime,
      },
    })
    await prisma.auditLog.create({
      data: {
        action: "CREATE",
        entity: "AvailabilityException",
        details: { date: date.data, type: "BLOQUEADO", startTime, endTime },
      },
    })
    revalidatePath("/agenda")
    return { success: true, message: "Horário bloqueado." }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Sem permissão")) {
      return { success: false, message: error.message }
    }
    console.error("[Agenda] Erro ao bloquear slot:", error)
    return { success: false, message: "Não foi possível bloquear o horário." }
  }
}

export async function saveAppointmentSettings(
  _prev: AgendaActionState | null,
  formData: FormData
): Promise<AgendaActionState> {
  try {
    await guard()

    const parse = (value: FormDataEntryValue | null, fallback: number, min: number, max: number) => {
      const n = Number(value)
      return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
    }

    const data = {
      minAdvanceHours: parse(formData.get("minAdvanceHours"), 2, 0, 72),
      maxAdvanceDays: parse(formData.get("maxAdvanceDays"), 60, 1, 365),
      cancelLimitHours: parse(formData.get("cancelLimitHours"), 12, 0, 168),
    }

    await prisma.appointmentSettings.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...data },
    })
    await prisma.auditLog.create({
      data: { action: "UPDATE", entity: "AppointmentSettings" },
    })
    revalidatePath("/agenda")
    return { success: true, message: "Regras de agendamento salvas!" }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Sem permissão")) {
      return { success: false, message: error.message }
    }
    console.error("[Agenda] Erro ao salvar regras:", error)
    return { success: false, message: "Não foi possível salvar as regras." }
  }
}
