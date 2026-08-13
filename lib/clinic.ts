/**
 * Dados da clínica (registro único). Usado no layout do sistema,
 * na página de impressão e na geração dos PDFs.
 */
import { prisma } from "@/lib/prisma"

export type ClinicInfo = {
  name: string
  address?: string | null
  phone?: string | null
  email?: string | null
  cnpj?: string | null
  logoDataUrl?: string | null
}

const DEFAULTS: ClinicInfo = {
  name: "Clínica Médica",
}

/** Carrega as configurações da clínica, com fallback para o padrão. */
export async function getClinicSettings(): Promise<ClinicInfo> {
  const settings = await prisma.clinicSettings.findUnique({ where: { id: 1 } })
  return settings
    ? {
        name: settings.name,
        address: settings.address,
        phone: settings.phone,
        email: settings.email,
        cnpj: settings.cnpj,
        logoDataUrl: settings.logoDataUrl,
      }
    : DEFAULTS
}
