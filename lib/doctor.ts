/**
 * Resolução do médico responsável pela assinatura de um registro.
 *
 * - MEDICO sempre assina com o próprio usuário (ignora o doctorId do form);
 * - ADMIN/SECRETARIA informam o doctorId no formulário, validado aqui
 *   (usuário ativo com papel MEDICO).
 */
import { prisma } from "@/lib/prisma"
import type { Role } from "@/lib/rbac"

export async function resolveDoctorId(input: {
  role: Role
  selfId: string
  doctorId: string | null
  required: boolean
}): Promise<{ doctorId: string | null; error?: string }> {
  if (input.role === "MEDICO") {
    return { doctorId: input.selfId }
  }

  const raw = input.doctorId?.trim() || null
  if (!raw) {
    return input.required
      ? {
          doctorId: null,
          error: "Selecione o médico responsável pela assinatura",
        }
      : { doctorId: null }
  }

  const doctor = await prisma.user.findFirst({
    where: { id: raw, role: "MEDICO", active: true },
    select: { id: true },
  })
  if (!doctor) {
    return { doctorId: null, error: "O médico selecionado não é válido" }
  }

  return { doctorId: doctor.id }
}

export type DoctorOption = {
  id: string
  name: string
  crm: string | null
}

/** Lista os médicos ativos para o seletor de responsável nos formulários. */
export async function listActiveDoctors(): Promise<DoctorOption[]> {
  return prisma.user.findMany({
    where: { role: "MEDICO", active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, crm: true },
  })
}
