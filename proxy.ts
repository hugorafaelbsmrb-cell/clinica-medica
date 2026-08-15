import NextAuth from "next-auth"
import { authConfig } from "@/lib/auth.config"

const { auth } = NextAuth(authConfig)

export default auth

export const config = {
  matcher: [
    // Protege as páginas internas; APIs são protegidas nos próprios handlers
    // (via auth()) para não interferir no fluxo de login.
    // Ícones do App Router e assets do PWA (manifest, service worker,
    // ícones de instalação) precisam ficar públicos.
    "/((?!api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|sw.js|manifest.webmanifest|icons/|login-cover.jpg|pitch|pagamento).*)",
  ],
}

