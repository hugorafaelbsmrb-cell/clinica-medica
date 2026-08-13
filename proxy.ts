import NextAuth from "next-auth"
import { authConfig } from "@/lib/auth.config"

const { auth } = NextAuth(authConfig)

export default auth

export const config = {
  matcher: [
    // Protege as páginas internas; APIs são protegidas nos próprios handlers
    // (via auth()) para não interferir no fluxo de login.
    // Ícones do App Router (icon.png etc.) precisam ficar públicos.
    "/((?!api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)",
  ],
}

