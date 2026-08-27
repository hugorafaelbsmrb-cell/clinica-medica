import type { NextAuthConfig } from "next-auth"
import type { Role } from "@/lib/rbac"

// Rotas protegidas: prefixo da rota -> perfis permitidos
// (duplicado de lib/rbac.ts de propósito: este arquivo roda em Edge Runtime
// e não pode importar módulos que usam next/navigation)
const routePermissions: Array<{ prefix: string; roles: Role[] }> = [
  { prefix: "/dashboard", roles: ["ADMIN", "MEDICO", "SECRETARIA", "FINANCEIRO"] },
  { prefix: "/agenda", roles: ["ADMIN", "MEDICO", "SECRETARIA"] },
  { prefix: "/pacientes", roles: ["ADMIN", "MEDICO", "SECRETARIA"] },
  { prefix: "/atendimentos", roles: ["ADMIN", "MEDICO", "SECRETARIA"] },
  { prefix: "/prescricoes", roles: ["ADMIN", "MEDICO"] },
  { prefix: "/planos-terapeuticos", roles: ["ADMIN", "MEDICO"] },
  { prefix: "/whatsapp", roles: ["ADMIN", "SECRETARIA"] },
  { prefix: "/financeiro", roles: ["ADMIN", "FINANCEIRO"] },
  { prefix: "/relatorios", roles: ["ADMIN", "MEDICO", "FINANCEIRO"] },
  { prefix: "/usuarios", roles: ["ADMIN"] },
  { prefix: "/configuracoes", roles: ["ADMIN"] },
]

export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl
      const isLoggedIn = !!auth?.user

      // Já logado tenta acessar o login -> manda para o dashboard
      if (pathname.startsWith("/login")) {
        if (isLoggedIn) {
          return Response.redirect(new URL("/dashboard", request.nextUrl))
        }
        return true
      }

      // Página pública de pré-cadastro do paciente (autoatendimento)
      if (pathname.startsWith("/cadastro")) {
        return true
      }

      // Página pública de cancelamento de consulta (link da confirmação)
      if (pathname.startsWith("/cancelar")) {
        return true
      }

      // Página pública de pagamento (link enviado ao paciente; o acesso é
      // protegido pelo id imprevisível do Payment, mesmo padrão do /cancelar)
      if (pathname.startsWith("/pagar")) {
        return true
      }

      // Página de status de pagamento (retorno após checkout/QR Code)
      if (pathname.startsWith("/pagamento")) {
        return true
      }

      if (!isLoggedIn) return false

      const rule = routePermissions.find((r) => pathname.startsWith(r.prefix))
      if (!rule) return true

      // Sem permissão para a área -> dashboard
      if (!rule.roles.includes(auth.user.role)) {
        return Response.redirect(new URL("/dashboard", request.nextUrl))
      }

      return true
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as { role?: Role }).role
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = (token.role as Role) ?? "SECRETARIA"
      }
      return session
    },
  },
} satisfies NextAuthConfig
