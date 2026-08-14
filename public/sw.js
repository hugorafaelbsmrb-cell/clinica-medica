/**
 * Service worker mínimo do PWA.
 *
 * Estratégia segura para uma aplicação com dados dinâmicos:
 * - Cacheia apenas os assets estáticos versionados do Next.js (/_next/static)
 *   e as imagens fixas (ícones/logo), nunca HTML ou respostas de API.
 * - Todo o restante (navegação, server actions, API) passa direto pela rede,
 *   então nunca há risco de servir dados desatualizados após login.
 * A presença deste fetch handler é o que habilita o prompt de instalação.
 */
const CACHE_NAME = "clinica-medica-v1"

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Assets do Next.js têm hash no nome: cache-first é seguro.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request)
        if (cached) return cached
        const response = await fetch(request)
        if (response.ok) cache.put(request, response.clone())
        return response
      })
    )
    return
  }

  // Ícones e imagens fixas: serve do cache e atualiza em segundo plano.
  if (url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request)
        const network = fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone())
          return response
        })
        if (cached) return cached
        return network
      })
    )
  }
})
