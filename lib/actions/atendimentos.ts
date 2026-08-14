"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { getClinicSettings } from "@/lib/clinic"
import { geocodeAddress } from "@/lib/geo"
import {
  defaultAutomationMessage,
  queueThankYouMessage,
} from "@/lib/whatsapp/automations"
import {
  renderTemplate,
  sendImmediateMessage,
} from "@/lib/whatsapp/message-service"

const atendimentoSchema = z.object({
  patientId: z.string().min(1, "Selecione o paciente"),
  type: z.enum(["PRESENCIAL", "DOMICILIAR"]),
  scheduledAt: z.string().min(1, "Informe a data"),
  homeAddress: z.string().optional().nullable(),
  latitude: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return null
      const number = Number(value)
      return Number.isFinite(number) ? number : null
    })
    .pipe(z.number().min(-90).max(90).nullable()),
  longitude: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return null
      const number = Number(value)
      return Number.isFinite(number) ? number : null
    })
    .pipe(z.number().min(-180).max(180).nullable()),
  locationSource: z
    .enum(["GPS", "GEOCODE", "PATIENT", "MANUAL"])
    .optional()
    .nullable(),
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
    latitude: formData.get("latitude") ?? undefined,
    longitude: formData.get("longitude") ?? undefined,
    locationSource: formData.get("locationSource") || null,
    anamnesis: formData.get("anamnesis") || null,
    value: formData.get("value") || 0,
  })

  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return { success: false, message: firstError?.message ?? "Dados inválidos" }
  }

  const data = parsed.data
  const hasCoords = data.latitude !== null && data.longitude !== null

  // Atendimento domiciliar precisa de endereço (valida antes de criar)
  if (data.type === "DOMICILIAR" && !data.homeAddress) {
    return {
      success: false,
      message: "Atendimento domiciliar exige o endereço do domicílio",
    }
  }

  const attendance = await prisma.attendance.create({
    data: {
      patientId: data.patientId,
      doctorId: session.user.role === "MEDICO" ? session.user.id : null,
      type: data.type,
      scheduledAt: new Date(data.scheduledAt),
      homeAddress: data.homeAddress || null,
      latitude: hasCoords ? data.latitude : null,
      longitude: hasCoords ? data.longitude : null,
      locationSource: hasCoords ? data.locationSource : null,
      anamnesis: data.anamnesis || null,
      value: data.value,
    },
  })

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

  // Automação: mensagem de agradecimento ao finalizar a consulta.
  // Não bloqueia a ação se a automação falhar.
  queueThankYouMessage(attendance.patientId).catch((error) => {
    console.error("[Automação] Falha no agradecimento pós-consulta:", error)
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

/**
 * Inicia o atendimento (módulo "Atendimentos do dia"): muda o status para
 * EM_ATENDIMENTO, grava a hora de início e avisa o paciente imediatamente
 * pelo WhatsApp que o médico está a caminho (envio direto, sem o cron).
 * Apenas ADMIN e MEDICO.
 */
export async function startAttendance(id: string): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  if (session.user.role !== "ADMIN" && session.user.role !== "MEDICO") {
    return {
      success: false,
      message: "Apenas médicos podem iniciar o atendimento",
    }
  }

  const attendance = await prisma.attendance.findUnique({
    where: { id },
    include: { patient: true },
  })
  if (!attendance) {
    return { success: false, message: "Atendimento não encontrado" }
  }
  if (attendance.status !== "AGENDADO") {
    return {
      success: true,
      message:
        attendance.status === "EM_ATENDIMENTO"
          ? "Atendimento já iniciado"
          : "Este atendimento não está mais agendado",
    }
  }

  const now = new Date()
  await prisma.attendance.update({
    where: { id },
    data: { status: "EM_ATENDIMENTO", startedAt: now },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "START",
      entity: "Attendance",
      entityId: id,
      patientId: attendance.patientId,
    },
  })

  // Aviso "médico a caminho": envio direto via provider (não espera o cron).
  // Respeita WhatsApp habilitado + consentimento LGPD + telefone cadastrado.
  let notifyError: string | null = null
  if (
    attendance.patient.phone &&
    attendance.patient.whatsappEnabled &&
    attendance.patient.lgpdConsent
  ) {
    const clinic = await getClinicSettings()
    if (clinic.autoACaminhoEnabled) {
      const msg =
        clinic.autoACaminhoMsg?.trim() || defaultAutomationMessage("acaminho")
      const content = renderTemplate(msg, {
        nome: attendance.patient.name.split(" ")[0],
        data: now.toLocaleDateString("pt-BR"),
      })
      const result = await sendImmediateMessage(
        attendance.patientId,
        "MEDICO_A_CAMINHO",
        content,
        attendance.id
      )
      if (!result.ok) notifyError = result.error ?? "Falha no envio"
    }
  }

  revalidatePath("/atendimentos-do-dia")
  revalidatePath("/atendimentos")
  revalidatePath(`/atendimentos/${id}`)
  return {
    success: true,
    message: notifyError
      ? "Atendimento iniciado, mas o aviso ao paciente falhou"
      : "Atendimento iniciado — paciente avisado",
    attendanceId: id,
  }
}

/**
 * Geocodifica o endereço digitado no formulário de agendamento
 * (Nominatim). Usada pelo botão "Buscar coordenadas pelo endereço"
 * quando o endereço do atendimento difere do cadastro do paciente.
 */
export async function geocodeAttendanceAddress(query: string): Promise<{
  success: boolean
  latitude?: number
  longitude?: number
  message?: string
}> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }

  const trimmed = query.trim()
  if (trimmed.length < 8) {
    return { success: false, message: "Informe um endereço completo" }
  }

  const coords = await geocodeAddress(trimmed)
  if (!coords) {
    return { success: false, message: "Endereço não encontrado no mapa" }
  }

  return {
    success: true,
    latitude: coords.latitude,
    longitude: coords.longitude,
  }
}
