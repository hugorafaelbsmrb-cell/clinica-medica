"use client"

import { useEffect } from "react"

/**
 * Registra o service worker do PWA apenas em produção (em dev, o SW
 * poderia cachear e atrapalhar o hot reload). Falha silenciosa: o PWA
 * é opcional e nunca deve quebrar o carregamento do app.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return
    if (!("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/sw.js").catch(() => {})
  }, [])

  return null
}
