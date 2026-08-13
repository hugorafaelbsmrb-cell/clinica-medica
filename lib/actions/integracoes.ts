"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import {
  invalidateIntegrationCache,
  testDeepSeekConnection,
  testWApiConnection,
} from "@/lib/integrations"

export type ActionState = {
  success: boolean
  message: string
}

const integrationsSchema = z.object({
  deepseekApiKey: z.string().optional(),
  wApiInstance: z.string().optional(),
  wApiToken: z.string().optional(),
})

/**
 * Salva as credenciais de integração (DeepSeek + W-API) no registro
 * da clínica (id = 1). Campos vazios removem a credencial salva.
 */
export async function saveIntegrations(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return {
      success: false,
      message: "Apenas administradores podem alterar as integrações",
    }
  }

  const parsed = integrationsSchema.safeParse({
    deepseekApiKey: formData.get("deepseekApiKey"),
    wApiInstance: formData.get("wApiInstance"),
    wApiToken: formData.get("wApiToken"),
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
      deepseekApiKey: data.deepseekApiKey?.trim() || null,
      wApiInstance: data.wApiInstance?.trim() || null,
      wApiToken: data.wApiToken?.trim() || null,
    },
    create: {
      id: 1,
      deepseekApiKey: data.deepseekApiKey?.trim() || null,
      wApiInstance: data.wApiInstance?.trim() || null,
      wApiToken: data.wApiToken?.trim() || null,
    },
  })

  invalidateIntegrationCache()

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "ClinicSettings",
      entityId: "integracoes",
    },
  })

  revalidatePath("/", "layout")
  return { success: true, message: "Integrações salvas" }
}

/**
 * Testa a conexão de uma integração usando os valores informados no
 * formulário. Os campos já vêm preenchidos com as credenciais salvas.
 */
export async function testIntegration(input: {
  service: "deepseek" | "wapi"
  deepseekApiKey?: string
  wApiInstance?: string
  wApiToken?: string
}): Promise<ActionState> {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return {
      success: false,
      message: "Apenas administradores podem testar as integrações",
    }
  }

  if (input.service === "deepseek") {
    const key = input.deepseekApiKey?.trim()
    if (!key) {
      return {
        success: false,
        message: "Informe a chave da DeepSeek para testar",
      }
    }
    return testDeepSeekConnection(key)
  }

  const instance = input.wApiInstance?.trim()
  const token = input.wApiToken?.trim()
  if (!instance || !token) {
    return {
      success: false,
      message: "Preencha o ID da instância e o token da W-API para testar",
    }
  }
  return testWApiConnection(instance, token)
}
