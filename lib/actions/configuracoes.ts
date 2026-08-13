"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"

export type ActionState = {
  success: boolean
  message: string
}

const MAX_LOGO_BYTES = 1024 * 1024 // 1 MB

const clinicSchema = z.object({
  name: z.string().min(2, "Informe o nome da clínica"),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z
    .union([z.string().email("E-mail inválido"), z.literal("")])
    .optional(),
  cnpj: z.string().optional(),
  horarioAtendimento: z.string().optional(),
  logoDataUrl: z.string().optional(),
})

/**
 * Salva as configurações da clínica (registro único, id = 1).
 * A logo chega como data URL (data:image/png;base64,...) — só PNG/JPEG,
 * pois o pdfkit não embute outros formatos.
 */
export async function saveClinicSettings(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return {
      success: false,
      message: "Apenas administradores podem alterar as configurações",
    }
  }

  const logoDataUrl = formData.get("logoDataUrl")?.toString() ?? ""

  if (logoDataUrl) {
    const isImage = /^data:image\/(png|jpe?g);base64,/.test(logoDataUrl)
    if (!isImage) {
      return {
        success: false,
        message: "Logo inválida — use uma imagem PNG ou JPEG",
      }
    }
    const base64 = logoDataUrl.split(",")[1] ?? ""
    const sizeBytes = Math.ceil((base64.length * 3) / 4)
    if (sizeBytes > MAX_LOGO_BYTES) {
      return {
        success: false,
        message: "Logo muito grande — use uma imagem de até 1 MB",
      }
    }
  }

  const parsed = clinicSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    cnpj: formData.get("cnpj"),
    horarioAtendimento: formData.get("horarioAtendimento"),
    logoDataUrl: logoDataUrl || undefined,
  })

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos",
    }
  }

  const data = parsed.data
  await prisma.clinicSettings.upsert({
    where: { id: 1 },
    update: {
      name: data.name,
      address: data.address || null,
      phone: data.phone || null,
      email: data.email || null,
      cnpj: data.cnpj || null,
      horarioAtendimento: data.horarioAtendimento || null,
      logoDataUrl: data.logoDataUrl || null,
    },
    create: {
      id: 1,
      name: data.name,
      address: data.address || null,
      phone: data.phone || null,
      email: data.email || null,
      cnpj: data.cnpj || null,
      horarioAtendimento: data.horarioAtendimento || null,
      logoDataUrl: data.logoDataUrl || null,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "ClinicSettings",
      entityId: "1",
    },
  })

  revalidatePath("/", "layout")
  return { success: true, message: "Configurações salvas" }
}
