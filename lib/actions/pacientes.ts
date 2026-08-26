"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { queueFirstContact } from "@/lib/whatsapp/message-service"
import { buildAddress, geocodeAddress } from "@/lib/geo"

const pacienteSchema = z.object({
  name: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
  cpf: z.string().optional().nullable(),
  birthDate: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email("E-mail inválido").optional().or(z.literal("")),
  street: z.string().optional().nullable(),
  number: z.string().optional().nullable(),
  complement: z.string().optional().nullable(),
  neighborhood: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zipCode: z.string().optional().nullable(),
  insurance: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  consultationReason: z.string().optional().nullable(),
  doctorId: z.string().optional().nullable(),
  latitude: z
    .string()
    .optional()
    .nullable()
    .transform((value) => {
      const trimmed = (value ?? "").trim()
      const n = Number(trimmed)
      return trimmed !== "" && Number.isFinite(n) ? n : null
    })
    .refine((value) => value === null || (value >= -90 && value <= 90), {
      message: "Latitude inválida",
    }),
  longitude: z
    .string()
    .optional()
    .nullable()
    .transform((value) => {
      const trimmed = (value ?? "").trim()
      const n = Number(trimmed)
      return trimmed !== "" && Number.isFinite(n) ? n : null
    })
    .refine((value) => value === null || (value >= -180 && value <= 180), {
      message: "Longitude inválida",
    }),
  locationSource: z.enum(["GPS", "GEOCODE", "MANUAL"]).optional().nullable(),
  lgpdConsent: z.boolean(),
  whatsappEnabled: z.boolean(),
})

export type PacienteInput = z.infer<typeof pacienteSchema>

export type ActionState = {
  success: boolean
  message: string
  patientId?: string
}

export async function createPatient(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) {
    return { success: false, message: "Sessão expirada" }
  }

  const raw = Object.fromEntries(formData.entries())
  const parsed = pacienteSchema.safeParse({
    ...raw,
    lgpdConsent: formData.get("lgpdConsent") === "on",
    whatsappEnabled: formData.get("whatsappEnabled") === "on",
  })

  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return { success: false, message: firstError?.message ?? "Dados inválidos" }
  }

  const data = parsed.data

  // Médico responsável: apenas ADMIN define; valida médico ativo.
  let doctorId: string | null = null
  if (session.user.role === "ADMIN") {
    const rawDoctorId = String(formData.get("doctorId") ?? "").trim()
    if (rawDoctorId) {
      const doctor = await prisma.user.findFirst({
        where: { id: rawDoctorId, role: "MEDICO", active: true },
        select: { id: true },
      })
      if (!doctor) {
        return { success: false, message: "Médico responsável inválido" }
      }
      doctorId = doctor.id
    }
  }

  // CPF duplicado?
  if (data.cpf) {
    const existing = await prisma.patient.findUnique({ where: { cpf: data.cpf } })
    if (existing) {
      return { success: false, message: "Já existe um paciente com este CPF" }
    }
  }

  const patient = await prisma.patient.create({
    data: {
      name: data.name,
      cpf: data.cpf || null,
      birthDate: data.birthDate ? new Date(data.birthDate) : null,
      phone: data.phone || null,
      email: data.email || null,
      street: data.street || null,
      number: data.number || null,
      complement: data.complement || null,
      neighborhood: data.neighborhood || null,
      city: data.city || null,
      state: data.state || null,
      zipCode: data.zipCode || null,
      insurance: data.insurance || null,
      notes: data.notes || null,
      consultationReason: data.consultationReason || null,
      doctorId,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      locationSource: data.locationSource ?? null,
      locationUpdatedAt:
        data.latitude !== null && data.longitude !== null ? new Date() : null,
      lgpdConsent: data.lgpdConsent,
      lgpdConsentAt: data.lgpdConsent ? new Date() : null,
      whatsappEnabled: data.lgpdConsent && data.whatsappEnabled,
    },
  })

  // Registro de auditoria (LGPD)
  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CREATE",
      entity: "Patient",
      entityId: patient.id,
      patientId: patient.id,
      details: { name: patient.name },
    },
  })

  // Primeiro contato via WhatsApp, se habilitado
  if (patient.whatsappEnabled && patient.phone) {
    await queueFirstContact(patient.id)
  }

  revalidatePath("/pacientes")
  return { success: true, message: "Paciente cadastrado", patientId: patient.id }
}

export async function updatePatient(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) {
    return { success: false, message: "Sessão expirada" }
  }

  const id = formData.get("id")?.toString()
  if (!id) return { success: false, message: "Paciente não identificado" }

  const parsed = pacienteSchema.safeParse({
    ...Object.fromEntries(formData.entries()),
    lgpdConsent: formData.get("lgpdConsent") === "on",
    whatsappEnabled: formData.get("whatsappEnabled") === "on",
  })

  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return { success: false, message: firstError?.message ?? "Dados inválidos" }
  }

  const data = parsed.data

  if (data.cpf) {
    const existing = await prisma.patient.findUnique({ where: { cpf: data.cpf } })
    if (existing && existing.id !== id) {
      return { success: false, message: "Já existe um paciente com este CPF" }
    }
  }

  const previous = await prisma.patient.findUnique({ where: { id } })

  // Médico responsável: apenas ADMIN altera; demais papéis preservam o vínculo.
  let doctorId = previous?.doctorId ?? null
  if (session.user.role === "ADMIN") {
    const rawDoctorId = String(formData.get("doctorId") ?? "").trim()
    if (rawDoctorId) {
      const doctor = await prisma.user.findFirst({
        where: { id: rawDoctorId, role: "MEDICO", active: true },
        select: { id: true },
      })
      if (!doctor) {
        return { success: false, message: "Médico responsável inválido" }
      }
      doctorId = doctor.id
    } else {
      doctorId = null
    }
  }

  await prisma.patient.update({
    where: { id },
    data: {
      name: data.name,
      cpf: data.cpf || null,
      birthDate: data.birthDate ? new Date(data.birthDate) : null,
      phone: data.phone || null,
      email: data.email || null,
      street: data.street || null,
      number: data.number || null,
      complement: data.complement || null,
      neighborhood: data.neighborhood || null,
      city: data.city || null,
      state: data.state || null,
      zipCode: data.zipCode || null,
      insurance: data.insurance || null,
      notes: data.notes || null,
      consultationReason: data.consultationReason || null,
      doctorId,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      locationSource: data.locationSource ?? null,
      locationUpdatedAt:
        data.latitude !== null &&
        data.longitude !== null &&
        (previous?.latitude !== data.latitude ||
          previous?.longitude !== data.longitude)
          ? new Date()
          : previous?.locationUpdatedAt,
      lgpdConsent: data.lgpdConsent,
      lgpdConsentAt:
        data.lgpdConsent && !previous?.lgpdConsent
          ? new Date()
          : previous?.lgpdConsentAt,
      whatsappEnabled: data.lgpdConsent && data.whatsappEnabled,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "Patient",
      entityId: id,
      patientId: id,
      details: { name: data.name },
    },
  })

  revalidatePath("/pacientes")
  revalidatePath(`/pacientes/${id}`)
  return { success: true, message: "Paciente atualizado", patientId: id }
}

export async function deletePatient(id: string): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) {
    return { success: false, message: "Sessão expirada" }
  }

  // Não permite excluir paciente com histórico: os vínculos em cascata
  // apagariam atendimentos, prescrições e cobranças já registradas.
  const linked = await prisma.patient.findUnique({
    where: { id },
    select: {
      _count: {
        select: { attendances: true, prescriptions: true, payments: true },
      },
    },
  })
  if (!linked) return { success: false, message: "Paciente não encontrado" }
  if (
    linked._count.attendances > 0 ||
    linked._count.prescriptions > 0 ||
    linked._count.payments > 0
  ) {
    return {
      success: false,
      message:
        "Não é possível excluir: o paciente possui atendimentos, prescrições ou cobranças registradas",
    }
  }

  await prisma.patient.delete({ where: { id } })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "DELETE",
      entity: "Patient",
      entityId: id,
    },
  })

  revalidatePath("/pacientes")
  return { success: true, message: "Paciente removido" }
}

/**
 * Geocodifica o endereço do paciente (Nominatim) para o formulário
 * preencher os campos ocultos de latitude/longitude (fonte GEOCODE).
 */
export async function geocodePatientAddress(input: {
  street: string
  number?: string
  neighborhood?: string
  city: string
  state?: string
}): Promise<{
  success: boolean
  latitude?: number
  longitude?: number
  message?: string
}> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }

  const address = buildAddress(input)
  if (!address.trim()) {
    return { success: false, message: "Informe rua e cidade para buscar" }
  }

  const result = await geocodeAddress(address)
  if (!result) {
    return {
      success: false,
      message: "Endereço não encontrado. Confira os dados ou marque no mapa.",
    }
  }

  return {
    success: true,
    latitude: result.latitude,
    longitude: result.longitude,
  }
}
