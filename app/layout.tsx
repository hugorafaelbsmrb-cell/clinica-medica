import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/sonner"
import { PwaRegister } from "@/components/pwa/pwa-register"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: {
    default: "Clínica Médica",
    template: "%s | Clínica Médica",
  },
  description: "Sistema de gestão para clínica médica",
  applicationName: "Clínica Médica",
  // PWA no iOS: abre em tela cheia quando adicionado à tela inicial.
  appleWebApp: {
    capable: true,
    title: "Clínica Médica",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster position="top-right" richColors />
        <PwaRegister />
      </body>
    </html>
  )
}
