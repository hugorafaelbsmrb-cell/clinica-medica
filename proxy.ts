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
    // /pagar é a página pública de pagamento enviada ao paciente pelo link.
    // /boas-vindas.mp4 é o vídeo do bot, baixado pela W-API ao enviar mídia.
    "/((?!api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|sw.js|manifest.webmanifest|icons/|login-cover.jpg|pitch|pagamento|pagar|boas-vindas.mp4).*)",
  ],
}

