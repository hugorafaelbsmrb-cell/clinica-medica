import type { Metadata, Viewport } from "next"
import { Poppins } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/sonner"
import { PwaRegister } from "@/components/pwa/pwa-register"

// Poppins cobre os pesos usados no app (400/500/600/700) — fonte única
// para interface, títulos e códigos (tokens/URLs).
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
})

export const metadata: Metadata = {
  title: {
    default: "Médico em Domicílio",
    template: "%s | Médico em Domicílio",
  },
  description: "Sistema de gestão de atendimentos médicos domiciliares",
  applicationName: "Médico em Domicílio",
  // PWA no iOS: abre em tela cheia quando adicionado à tela inicial.
  appleWebApp: {
    capable: true,
    title: "Médico em Domicílio",
    statusBarStyle: "default",
  },
  // Next 16 não emite mais este meta a partir de appleWebApp.capable;
  // ele ainda é usado por iPhones com iOS < 16.4 (instalação legada).
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
}

// Garante a escala correta em telas pequenas (celulares) e a cor da
// barra de status no PWA (tema neutro claro/escuro do app).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${poppins.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster position="top-right" richColors />
        <PwaRegister />
      </body>
    </html>
  )
}
