/**
 * Cliente do repositório de mídias (Circuito Kids — https://api.circuitokids.com.br).
 *
 * Auth: POST /auth.php { action: "login_api_key", api_key } → { token (JWT 24h),
 * user.company_slug }. O JWT fica em cache em memória e é renovado antes de
 * expirar (~23h) ou quando um endpoint responde 401.
 *
 * Endpoints:
 *  - GET /public.php?company={slug}&page=1[&type=image|video] — sem auth,
 *    retorna files[].{ id, name, type (mime), url } prontas para o picker.
 *  - POST /upload.php (multipart, campo "file", header Authorization: Bearer)
 *    → { success, id, path }. Limite 50 MB/arquivo.
 *  - DELETE /upload.php com { id } (Bearer).
 *
 * A API Key fica só no servidor (ClinicSettings ou .env) e nunca vai à tela.
 */
import { getIntegrationSettings, MEDIA_API_BASE } from "@/lib/integrations"

export type MediaFile = {
  id: number
  name: string
  url: string
  /** Mime type do arquivo (ex.: "image/jpeg", "video/mp4"). */
  type: string
}

let cachedToken: { token: string; expiresAt: number } | null = null

/**
 * Devolve o JWT do storage trocando a API Key salva. O cache em memória
 * dura ~23h (o JWT expira em 24h); em 401 o chamador pode forçar a troca.
 */
async function getMediaToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token
  }

  const settings = await getIntegrationSettings()
  if (!settings.mediaApiKey) {
    throw new Error("API de mídias não configurada — informe a chave em Configurações → Integrações → Mídias")
  }

  const response = await fetch(`${MEDIA_API_BASE}/auth.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "login_api_key",
      api_key: settings.mediaApiKey,
    }),
  })

  const text = await response.text()
  let data: { token?: string; error?: string; message?: string } = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = {}
  }

  if (!response.ok || !data.token) {
    const detail = data.error || data.message || `status ${response.status}`
    throw new Error(`Falha na autenticação do storage: ${detail}`)
  }

  cachedToken = {
    token: data.token,
    // Renova aos ~23h para nunca bater a expiração de 24h do JWT.
    expiresAt: Date.now() + 23 * 60 * 60 * 1000,
  }
  return data.token
}

/** Executa uma chamada autenticada; em 401 renova o JWT e tenta mais uma vez. */
async function authenticatedRequest(
  path: string,
  init: RequestInit
): Promise<Response> {
  let token = await getMediaToken()
  let response = await fetch(`${MEDIA_API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  })

  if (response.status === 401) {
    token = await getMediaToken(true)
    response = await fetch(`${MEDIA_API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    })
  }
  return response
}

/**
 * Lista as mídias do repositório pelo endpoint público (sem auth).
 * `type` opcional: "image" | "video" | undefined (todas).
 */
export async function listMediaFiles(type?: "image" | "video"): Promise<MediaFile[]> {
  const settings = await getIntegrationSettings()
  if (!settings.mediaSlug) {
    throw new Error("API de mídias não configurada — teste a chave em Configurações → Integrações → Mídias")
  }

  const query = new URLSearchParams({ company: settings.mediaSlug, page: "1" })
  if (type) query.set("type", type)

  const response = await fetch(
    `${MEDIA_API_BASE}/public.php?${query.toString()}`,
    { cache: "no-store" }
  )
  if (!response.ok) {
    throw new Error(`Falha ao listar mídias (status ${response.status})`)
  }

  const data = (await response.json()) as {
    files?: Array<{
      id?: number
      name?: string
      url?: string
      type?: string
    }>
  }

  return (data.files ?? [])
    .filter((file) => file.id != null && file.url)
    .map((file) => ({
      id: file.id!,
      name: file.name ?? "",
      url: file.url!,
      type: file.type ?? "",
    }))
}

/**
 * Sobe um arquivo para o storage (multipart, campo "file") e devolve a URL
 * pública. `file` é um Blob/File do navegador ou um Buffer do Node.
 */
export async function uploadMedia(
  file: Blob | Buffer,
  fileName: string,
  mime: string
): Promise<{ id: number; url: string }> {
  const form = new FormData()
  const blob =
    file instanceof Blob ? file : new Blob([new Uint8Array(file)], { type: mime })
  form.append("file", blob, fileName)

  const response = await authenticatedRequest("/upload.php", {
    method: "POST",
    body: form,
  })

  const text = await response.text()
  let data: {
    success?: boolean
    id?: number
    path?: string
    url?: string
    error?: string
    message?: string
  } = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = {}
  }

  if (!response.ok || data.success === false) {
    const detail = data.error || data.message || `status ${response.status}`
    throw new Error(`Falha no upload: ${detail}`)
  }

  // A API devolve { success, id, path }; a URL pública segue o padrão
  // https://api.circuitokids.com.br/{path}. Se vier url pronta, usa direto.
  const url = data.url || (data.path ? `${MEDIA_API_BASE}/${data.path}` : "")
  if (!url || data.id == null) {
    throw new Error("Upload concluído, mas a API não retornou a URL do arquivo")
  }
  return { id: data.id, url }
}

/** Remove uma mídia do storage pelo id. */
export async function deleteMedia(id: number): Promise<void> {
  const response = await authenticatedRequest("/upload.php", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    let detail = ""
    try {
      const data = text ? JSON.parse(text) : {}
      detail = data.error || data.message || ""
    } catch {
      detail = text
    }
    throw new Error(`Falha ao excluir a mídia${detail ? `: ${detail}` : ""}`)
  }
}

/** Slug configurado (para a tela de configurações exibir o estado). */
export async function getMediaSlug(): Promise<string> {
  const settings = await getIntegrationSettings()
  return settings.mediaSlug
}
