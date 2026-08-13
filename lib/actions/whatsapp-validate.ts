"use server"

import { getWhatsAppProvider, normalizePhone } from "@/lib/whatsapp/provider"

export type ValidatePhoneState = {
  success: boolean
  exists?: boolean
  message: string
}

/**
 * Valida se um número de telefone está registrado no WhatsApp.
 * Público: usado no pré-cadastro online, onde o paciente ainda não tem sessão.
 */
export async function validateWhatsAppNumber(input: {
  phone: string
}): Promise<ValidatePhoneState> {
  const digits = (input.phone ?? "").replace(/\D/g, "")

  if (digits.length < 10 || digits.length > 13) {
    return {
      success: false,
      message: "Informe um telefone válido com DDD para verificar",
    }
  }

  const provider = await getWhatsAppProvider()
  const result = await provider.validatePhone(normalizePhone(digits))

  if (!result.ok) {
    console.error("[WhatsApp] Falha ao validar número:", result.error)
    return {
      success: false,
      message:
        "Não foi possível verificar o número agora. Tente novamente em instantes.",
    }
  }

  return {
    success: true,
    exists: result.exists,
    message: result.exists
      ? "Este número tem WhatsApp"
      : "Este número não tem WhatsApp",
  }
}