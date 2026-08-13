import NextAuth from "next-auth"
import { authConfig } from "@/lib/auth.config"

const { auth } = NextAuth(authConfig)

export default auth

export const config = {
  matcher: [
    // Protege as páginas internas; APIs são protegidas nos próprios handlers
    // (via auth()) para não interferir no fluxo de login
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
}

