import type { Session } from "next-auth"
import { redirect } from "next/navigation"

export type Role = "ADMIN" | "MEDICO" | "SECRETARIA" | "FINANCEIRO"

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrador",
  MEDICO: "Médico",
  SECRETARIA: "Secretária/Recepção",
  FINANCEIRO: "Financeiro",
}

// Mapa de permissões por perfil — cada chave é uma área do sistema
export const PERMISSIONS: Record<Role, string[]> = {
  ADMIN: [
    "dashboard",
    "agenda",
    "pacientes",
    "atendimentos",
    "prescricoes",
    "planos",
    "whatsapp",
    "financeiro",
    "relatorios",
    "usuarios",
    "configuracoes",
  ],
  MEDICO: ["dashboard", "agenda", "pacientes", "atendimentos", "prescricoes", "planos"],
  SECRETARIA: ["dashboard", "agenda", "pacientes", "atendimentos", "whatsapp"],
  FINANCEIRO: ["dashboard", "financeiro", "relatorios"],
}

export function hasPermission(role: Role | undefined, area: string): boolean {
  if (!role) return false
  return PERMISSIONS[role]?.includes(area) ?? false
}

/**
 * Proteção de páginas: redireciona para /login sem sessão,
 * ou para /dashboard sem permissão para a área.
 */
export function requireRole(
  session: Session | null,
  allowedRoles: Role[]
): Session {
  if (!session?.user) {
    redirect("/login")
  }

  const role = session.user.role as Role
  if (!allowedRoles.includes(role)) {
    redirect("/dashboard")
  }

  return session
}
