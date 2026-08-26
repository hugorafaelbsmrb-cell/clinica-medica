"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"

export type ActionState = {
  success: boolean
  message: string
  userId?: string
}

const userSchema = z.object({
  name: z.string().min(3, "Informe o nome"),
  email: z.string().email("E-mail inválido"),
  role: z.enum(["ADMIN", "MEDICO", "SECRETARIA", "FINANCEIRO"], {
    error: "Selecione o perfil",
  }),
  crm: z.string().optional(),
  signatureText: z.string().optional(),
  signatureImage: z
    .string()
    .max(800_000, "Imagem de assinatura muito grande (use até 500 KB)")
    .optional(),
})

export async function createUser(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return { success: false, message: "Apenas administradores podem criar usuários" }
  }

  const password = formData.get("password")?.toString() ?? ""
  const parsed = userSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    crm: formData.get("crm"),
    signatureText: formData.get("signatureText"),
    signatureImage: formData.get("signatureImage") || undefined,
  })

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }

  if (password.length < 6) {
    return { success: false, message: "A senha deve ter pelo menos 6 caracteres" }
  }

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  })
  if (existing) {
    return { success: false, message: "Já existe um usuário com este e-mail" }
  }

  const hashed = await bcrypt.hash(password, 10)
  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      password: hashed,
      role: parsed.data.role,
      crm: parsed.data.crm || null,
      signatureText: parsed.data.signatureText || null,
      signatureImage: parsed.data.signatureImage || null,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CREATE",
      entity: "User",
      entityId: user.id,
    },
  })

  revalidatePath("/usuarios")
  return { success: true, message: "Usuário criado", userId: user.id }
}

export async function updateUser(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return { success: false, message: "Apenas administradores podem editar usuários" }
  }

  const id = formData.get("id")?.toString() ?? ""
  const newPassword = formData.get("password")?.toString() ?? ""

  const parsed = userSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    crm: formData.get("crm"),
    signatureText: formData.get("signatureText"),
    signatureImage: formData.get("signatureImage") || undefined,
  })

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }

  if (newPassword && newPassword.length < 6) {
    return { success: false, message: "A nova senha deve ter pelo menos 6 caracteres" }
  }

  const existing = await prisma.user.findUnique({ where: { id } })
  if (!existing) return { success: false, message: "Usuário não encontrado" }

  const emailTaken = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  })
  if (emailTaken && emailTaken.id !== id) {
    return { success: false, message: "Já existe um usuário com este e-mail" }
  }

  await prisma.user.update({
    where: { id },
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      role: parsed.data.role,
      crm: parsed.data.crm || null,
      signatureText: parsed.data.signatureText || null,
      signatureImage: parsed.data.signatureImage || null,
      ...(newPassword ? { password: await bcrypt.hash(newPassword, 10) } : {}),
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "User",
      entityId: id,
    },
  })

  revalidatePath("/usuarios")
  return { success: true, message: "Usuário atualizado", userId: id }
}

/** Ativa/desativa o usuário. Não permite desativar a si mesmo. */
export async function toggleUserActive(userId: string): Promise<ActionState> {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return { success: false, message: "Apenas administradores podem alterar usuários" }
  }

  if (session.user.id === userId) {
    return { success: false, message: "Você não pode desativar seu próprio usuário" }
  }

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return { success: false, message: "Usuário não encontrado" }

  const next = !user.active
  await prisma.user.update({
    where: { id: userId },
    data: { active: next },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: next ? "ACTIVATE" : "DEACTIVATE",
      entity: "User",
      entityId: userId,
    },
  })

  revalidatePath("/usuarios")
  return {
    success: true,
    message: next ? "Usuário ativado" : "Usuário desativado",
    userId,
  }
}

/**
 * Autoatendimento: o médico (ou admin) atualiza a própria assinatura
 * virtual — imagem, texto de fallback e CRM — usada nos prontuários,
 * prescrições e planos terapêuticos.
 */
export async function updateMySignature(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user) return { success: false, message: "Sessão expirada" }
  if (session.user.role !== "MEDICO" && session.user.role !== "ADMIN") {
    return {
      success: false,
      message: "Apenas médicos cadastram a própria assinatura",
    }
  }

  const parsed = z
    .object({
      crm: z.string().optional(),
      signatureText: z.string().optional(),
      signatureImage: z
        .string()
        .max(800_000, "Imagem de assinatura muito grande (use até 500 KB)")
        .optional(),
    })
    .safeParse({
      crm: formData.get("crm"),
      signatureText: formData.get("signatureText"),
      signatureImage: formData.get("signatureImage") || undefined,
    })

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      crm: parsed.data.crm?.trim() || null,
      signatureText: parsed.data.signatureText?.trim() || null,
      signatureImage: parsed.data.signatureImage || null,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "User",
      entityId: session.user.id,
      details: { scope: "assinatura" },
    },
  })

  revalidatePath("/minha-assinatura")
  return { success: true, message: "Assinatura atualizada", userId: session.user.id }
}
