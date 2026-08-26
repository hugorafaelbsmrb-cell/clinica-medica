/**
 * Credenciais lembradas no dispositivo (PWA): o e-mail e a senha ficam
 * guardados no localStorage do navegador para que o login seja automático.
 * O botão "Sair" limpa este armazenamento — logout explícito não re-entra.
 */

const STORAGE_KEY = "auth.remembered-credentials"

export type StoredCredentials = {
  email: string
  password: string
}

export function saveCredentials(credentials: StoredCredentials) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials))
}

export function loadCredentials(): StoredCredentials | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      typeof parsed?.email === "string" &&
      typeof parsed?.password === "string"
    ) {
      return { email: parsed.email, password: parsed.password }
    }
  } catch {
    // dados corrompidos — trata como ausente
  }
  return null
}

export function clearCredentials() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(STORAGE_KEY)
}
