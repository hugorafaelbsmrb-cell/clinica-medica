import type { MetadataRoute } from "next"

/**
 * Manifest do PWA: permite instalar o Médico em Domicílio na tela inicial
 * (Android e iOS 16.4+) e abrir em modo standalone, como um app nativo.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Médico em Domicílio",
    short_name: "Médico em Domicílio",
    description: "Sistema de gestão do Médico em Domicílio — atendimentos home care",
    start_url: "/dashboard",
    display: "standalone",
    orientation: "portrait",
    lang: "pt-BR",
    background_color: "#ffffff",
    theme_color: "#0a0a0a",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  }
}
