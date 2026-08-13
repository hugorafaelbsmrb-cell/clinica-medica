"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { queueFirstContact } from "@/lib/whatsapp/message-service"

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
