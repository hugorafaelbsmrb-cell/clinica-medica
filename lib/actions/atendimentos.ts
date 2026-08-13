"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"

const atendimentoSchema = z.object({
  patientId: z.string().min(1, "Selecione o paciente"),
  type: z.enum(["PRESENCIAL", "DOMICILIAR"]),
  scheduledAt: z.string().min(1, "Informe a data"),
  homeAddress: z.string().optional().nullable(),
  anamnesis: z.string().optional().nullable(),
  value: z.coerce.number().min(0).default(0),
})

export type ActionState = {
  success: boolean
  message: string
  attendanceId?: string
}

export async function createAttendance(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }

  const parsed = atendimentoSchema.safeParse({
    patientId: formData.get("patientId"),
    type: formData.get("type"),
    scheduledAt: formData.get("scheduledAt"),
    homeAddress: formData.get("homeAddress") || null,
    anamnesis: formData.get("anamnesis") || null,
    value: formData.get("value") || 0,
  })

  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return { success: false, message: firstError?.message ?? "Dados inválidos" }
  }

  const data = parsed.data

  const attendance = await prisma.attendance.create({
    data: {
      patientId: data.patientId,
      doctorId: session.user.role === "MEDICO" ? session.user.id : null,
      type: data.type,
      scheduledAt: new Date(data.scheduledAt),
      homeAddress: data.homeAddress || null,
      anamnesis: data.anamnesis || null,
      value: data.value,
    },
  })

  // Atendimento domiciliar precisa de endereço
  if (data.type === "DOMICILIAR" && !data.homeAddress) {
    return {
      success: false,
      message: "Atendimento domiciliar exige o endereço do domicílio",
      attendanceId: attendance.id,
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CREATE",
      entity: "Attendance",
      entityId: attendance.id,
      patientId: attendance.patientId,
    },
  })

  revalidatePath("/atendimentos")
  return {
    success: true,
    message: "Atendimento agendado",
    attendanceId: attendance.id,
  }
}

/**
 * Marca o atendimento como REALIZADO e, se houver valor,
 * gera automaticamente a entrada de RECEITA no financeiro.
 */
export async function completeAttendance(id: string): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }

  const attendance = await prisma.attendance.findUnique({
    where: { id },
    include: { patient: true },
  })
  if (!attendance) return { success: false, message: "Atendimento não encontrado" }

  await prisma.$transaction(async (tx) => {
    await tx.attendance.update({
      where: { id },
      data: { status: "REALIZADO" },
    })

    if (attendance.value.gt(0)) {
      await tx.financialEntry.create({
        data: {
          type: "RECEITA",
          category:
            attendance.type === "DOMICILIAR"
              ? "CONSULTA_DOMICILIAR"
              : "CONSULTA_PRESENCIAL",
          description: `Atendimento — ${attendance.patient.name}`,
          value: attendance.value,
          dueDate: new Date(),
          attendanceId: id,
        },
      })
    }
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "COMPLETE",
      entity: "Attendance",
      entityId: id,
      patientId: attendance.patientId,
    },
  })

  revalidatePath("/atendimentos")
  revalidatePath(`/atendimentos/${id}`)
  return { success: true, message: "Atendimento marcado como realizado" }
}

export async function cancelAttendance(id: string): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }

  await prisma.attendance.update({
    where: { id },
    data: { status: "CANCELADO" },
  })

  revalidatePath("/atendimentos")
  revalidatePath(`/atendimentos/${id}`)
  return { success: true, message: "Atendimento cancelado" }
}
