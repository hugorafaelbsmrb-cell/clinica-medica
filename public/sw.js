/**
 * Service worker mínimo do PWA.
 *
 * Estratégia segura para uma aplicação com dados dinâmicos:
 * - Cacheia apenas os assets estáticos versionados do Next.js (/_next/static)
 *   e as imagens fixas (ícones/logo), nunca HTML ou respostas de API.
 * - Todo o restante (navegação, server actions, API) passa direto pela rede,
 *   então nunca há risco de servir dados desatualizados após login.
 * - Toda operação de cache é protegida: se o CacheStorage do navegador
 *   estiver corrompido (erro "Unexpected internal error"), o asset é
 *   servido direto da rede e nada quebra.
 * A presença deste fetch handler é o que habilita o prompt de instalação.
 */
const CACHE_NAME = "clinica-medica-v2"

/** Notificação recebida por Web Push: mostra na tela do celular. */
self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data?.json() ?? {}
  } catch {
    // payload não-JSON: usa os campos padrão
  }
  const { title = "Médico em Domicílio", body = "", url = "/dashboard", notificationId } = data
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: notificationId ?? undefined,
      data: { url, notificationId },
    })
  )
})

/** Toque na notificação: abre a página relacionada e marca como lida. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const { url = "/dashboard", notificationId } = event.notification.data ?? {}

  // Marca como lida no painel (se estiver logado; 401 é ignorado)
  if (notificationId) {
    event.waitUntil(
      fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [notificationId] }),
      }).catch(() => {})
    )
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            client.navigate(url)
            return client.focus()
          }
        }
        return self.clients.openWindow(url)
      })
  )
})

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Limpa caches de versões antigas (best-effort: se o CacheStorage
      // estiver corrompido, ignora e segue — a rede continua funcionando).
      try {
        const keys = await caches.keys()
        await Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      } catch {
        // CacheStorage indisponível: nada a fazer.
      }
      await self.clients.claim()
    })()
  )
})

/** Busca na rede e tenta guardar no cache (falha de cache é ignorada). */
async function networkFirst(request) {
  const response = await fetch(request)
  if (response.ok) {
    try {
      const cache = await caches.open(CACHE_NAME)
      await cache.put(request, response.clone())
    } catch {
      // Quota cheia ou cache corrompido: segue sem cachear.
    }
  }
  return response
}

/**
 * Tenta servir do cache; qualquer erro (ex.: CacheStorage corrompido)
 * cai direto para a rede, garantindo que assets nunca falhem por cache.
 */
async function cacheThenNetwork(request) {
  try {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(request)
    if (cached) return cached
    return await networkFirst(request)
  } catch {
    // CacheStorage corrompido: serve direto da rede.
    return fetch(request)
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Assets do Next.js têm hash no nome: cache-first é seguro.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheThenNetwork(request))
    return
  }

  // Ícones e imagens fixas: serve do cache e atualiza em segundo plano.
  if (url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheThenNetwork(request))
    return
  }
})
