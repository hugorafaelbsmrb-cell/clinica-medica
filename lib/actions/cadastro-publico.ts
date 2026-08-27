"use server"

import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { normalizePhone } from "@/lib/whatsapp/provider"
import { queueFirstContact } from "@/lib/whatsapp/message-service"
import { isValidCpf } from "@/lib/cpf"

/** Formata 11 dígitos como XXX.XXX.XXX-XX (para busca de CPFs já formatados). */
function formatCpf(digits: string): string {
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

/**
 * Pré-cadastro público do paciente (autoatendimento via /cadastro).
 * Não exige sessão: qualquer pessoa com o link pode se cadastrar.
 */
const cadastroSchema = z.object({
  name: z.string().trim().min(3, "Informe seu nome completo"),
  birthDate: z.string().optional().or(z.literal("")),
  cpf: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ?? "").replace(/\D/g, ""))
    .refine(
      (value) => value.length === 0 || value.length === 11,
      "Informe um CPF válido com 11 números"
    )
    // Dígitos verificadores: CPF inválido derruba a cobrança no gateway
    // (o Asaas recusa com "CPF/CNPJ inválido").
    .refine(
      (value) => value.length === 0 || isValidCpf(value),
      "Este CPF não é válido — confira os números digitados"
    ),
  phone: z
    .string()
    .transform((value) => value.replace(/\D/g, ""))
    .refine(
      (value) => value.length >= 10 && value.length <= 11,
      "Informe um telefone válido com DDD"
    ),
  street: z.string().trim().min(3, "Informe o nome da rua"),
  number: z.string().trim().min(1, "Informe o número"),
  neighborhood: z.string().trim().min(2, "Informe o bairro"),
  city: z.string().trim().min(2, "Informe a cidade"),
  latitude: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = (value ?? "").trim()
      const n = Number(trimmed)
      return trimmed !== "" && Number.isFinite(n) ? n : null
    })
    .refine((value) => value === null || (value >= -90 && value <= 90), {
      message: "Localização inválida",
    }),
  longitude: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = (value ?? "").trim()
      const n = Number(trimmed)
      return trimmed !== "" && Number.isFinite(n) ? n : null
    })
    .refine((value) => value === null || (value >= -180 && value <= 180), {
      message: "Localização inválida",
    }),
  consultationReason: z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => !value || value.length >= 5,
      "Conte brevemente o motivo da sua consulta"
    ),
  whatsappEnabled: z.enum(["sim", "nao"]),
  lgpdConsent: z.literal(true, {
    error: "Para concluir, é necessário autorizar o uso dos seus dados",
  }),
})

export type CadastroState = {
  success: boolean
  message: string
  patientId?: string
}

/**
 * Registra a tentativa de cadastro quando o visitante informa o telefone
 * (passo 1 do wizard). Usada pela automação de cadastro incompleto.
 */
export async function registerCadastroAttempt(input: {
  name: string
  phone: string
}): Promise<{ success: boolean }> {
  try {
    const phone = normalizePhone(input.phone.replace(/\D/g, ""))
    if (phone.length < 10) return { success: false }

    const name = input.name.trim() || null
    await prisma.registrationAttempt.upsert({
      where: { phone },
      // Reinicia o "timer" da tentativa, mas não reenvia lembrete
      // para quem já recebeu um.
      update: { name: name ?? undefined, createdAt: new Date() },
      create: { phone, name },
    })
    return { success: true }
  } catch (error) {
    console.error("[CadastroOnline] Erro ao registrar tentativa:", error)
    return { success: false }
  }
}

export async function cadastroPublico(
  _prev: CadastroState | null,
  formData: FormData
): Promise<CadastroState> {
  // Campo invisível anti-spam: robôs preenchem, humanos não
  if (formData.get("website")) {
    return { success: true, message: "Cadastro enviado com sucesso!" }
  }

  const parsed = cadastroSchema.safeParse({
    name: formData.get("name"),
    birthDate: formData.get("birthDate") ?? "",
    cpf: formData.get("cpf") ?? "",
    phone: formData.get("phone"),
    street: formData.get("street"),
    number: formData.get("number"),
    neighborhood: formData.get("neighborhood"),
    city: formData.get("city"),
    latitude: formData.get("latitude") ?? "",
    longitude: formData.get("longitude") ?? "",
    consultationReason: formData.get("consultationReason") ?? "",
    whatsappEnabled: formData.get("whatsappEnabled"),
    lgpdConsent: formData.get("lgpdConsent") === "on",
  })

  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return { success: false, message: firstError?.message ?? "Dados inválidos" }
  }

  const data = parsed.data

  // Data de nascimento opcional, mas precisa ser plausível
  let birthDate: Date | null = null
  if (data.birthDate) {
    const parsedDate = new Date(`${data.birthDate}T12:00:00`)
    if (
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.getFullYear() < 1900 ||
      parsedDate.getTime() > Date.now()
    ) {
      return { success: false, message: "Confira a data de nascimento informada" }
    }
    birthDate = parsedDate
  }

  try {
    const phone = normalizePhone(data.phone)

    // Telefone já cadastrado? (o número é a chave de contato da clínica)
    const existing = await prisma.patient.findFirst({
      where: { phone: { contains: phone.slice(2) } },
    })
    if (existing) {
      return {
        success: false,
        message:
          "Este telefone já está cadastrado na clínica. Se você já é paciente, volte ao primeiro passo e informe seu CPF para ir direto ao agendamento.",
      }
    }

    // CPF já cadastrado? orienta a usar o CPF no primeiro passo
    if (data.cpf) {
      const existingCpf = await prisma.patient.findFirst({
        where: { cpf: { in: [data.cpf, formatCpf(data.cpf)] } },
      })
      if (existingCpf) {
        return {
          success: false,
          message:
            "Já existe um cadastro com este CPF. Volte ao primeiro passo e informe seu CPF para ir direto ao agendamento.",
        }
      }
    }

    const whatsappEnabled = data.lgpdConsent && data.whatsappEnabled === "sim"

    // GPS do paciente (capturado no pré-cadastro, em casa)
    const hasGps = data.latitude !== null && data.longitude !== null

    const patient = await prisma.patient.create({
      data: {
        name: data.name,
        birthDate,
        cpf: data.cpf || null,
        phone,
        street: data.street,
        number: data.number,
        neighborhood: data.neighborhood,
        city: data.city,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        locationSource: hasGps ? "GPS" : null,
        locationUpdatedAt: hasGps ? new Date() : null,
        consultationReason: data.consultationReason || null,
        lgpdConsent: true,
        lgpdConsentAt: new Date(),
        whatsappEnabled,
        registeredVia: "ONLINE",
      },
    })

    // Marca a tentativa de cadastro como convertida (finalizou).
    // Sem await: não pode bloquear o fluxo do cadastro.
    prisma.registrationAttempt
      .updateMany({ where: { phone }, data: { converted: true } })
      .catch((error) =>
        console.error("[CadastroOnline] Erro ao converter tentativa:", error)
      )

    // Registro de auditoria (LGPD)
    await prisma.auditLog.create({
      data: {
        action: "CREATE",
        entity: "Patient",
        entityId: patient.id,
        patientId: patient.id,
        details: { name: patient.name, origem: "cadastro online" },
      },
    })

    // Mensagem de boas-vindas, se o paciente aceitou contato por WhatsApp
    if (whatsappEnabled) {
      await queueFirstContact(patient.id)
    }

    return {
      success: true,
      message: "Cadastro enviado com sucesso!",
      patientId: patient.id,
    }
  } catch (error) {
    console.error("[CadastroOnline] Erro ao cadastrar paciente:", error)
    return {
      success: false,
      message:
        "Não foi possível concluir o cadastro agora. Tente novamente ou fale com a nossa equipe.",
    }
  }
}
