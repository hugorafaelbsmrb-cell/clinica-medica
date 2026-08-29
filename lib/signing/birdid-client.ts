/**
 * Cliente HTTP da API pública do Bird ID (VaultID/Soluti) — certificado
 * digital em nuvem.
 *
 * Onboarding (1x por médico): OAuth2 Authorization Code + PKCE →
 * GET /v0/oauth/authorize (login_hint = CPF) → POST /v0/oauth/token
 * (code → access_token de vida curta) → GET /v0/oauth/certificate-discovery
 * (alias + certificado PEM). O token é usado apenas nesta troca e
 * descartado em seguida — nada de material de assinatura fica no servidor.
 *
 * A assinatura em si (push /async-signature) acontece só no microserviço
 * signer, que é quem detém client_id/client_secret da aplicação.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

const BIRDID_BASE_URL = (process.env.BIRDID_BASE_URL || "https://api.birdid.com.br").replace(/\/+$/, "")
const BIRDID_CLIENT_ID = process.env.BIRDID_CLIENT_ID || ""
const BIRDID_CLIENT_SECRET = process.env.BIRDID_CLIENT_SECRET || ""

/** True quando as credenciais do console Bird ID estão configuradas. */
export function birdIdConfigured(): boolean {
  return Boolean(BIRDID_CLIENT_ID && BIRDID_CLIENT_SECRET)
}

/** URI de retorno registrada no console Bird ID (env ou derivada da requisição). */
export function getBirdIdRedirectUri(requestUrl: string): string {
  const configured = process.env.BIRDID_REDIRECT_URI
  if (configured) return configured
  return `${new URL(requestUrl).origin}/api/birdid/callback`
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Verifier PKCE aleatório (RFC 7636, 43–128 chars base64url). */
export function generateCodeVerifier(): string {
  return base64Url(randomBytes(64))
}

/** Challenge PKCE S256 do verifier. */
export function computeCodeChallenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest())
}

/** URL do GET /v0/oauth/authorize com PKCE e login_hint (CPF do médico). */
export function buildBirdIdAuthorizeUrl(opts: {
  state: string
  codeChallenge: string
  redirectUri: string
  loginHint?: string
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: BIRDID_CLIENT_ID,
    redirect_uri: opts.redirectUri,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    scope: "authentication_session",
    state: opts.state,
    lifetime: "300",
  })
  if (opts.loginHint) params.set("login_hint", opts.loginHint)
  return `${BIRDID_BASE_URL}/v0/oauth/authorize?${params.toString()}`
}

export type BirdIdToken = {
  /** Token de acesso do usuário (vida curta, descartado após o onboarding). */
  accessToken: string
  /** CPF do titular que autorizou (authorized_identification da resposta). */
  cpf: string
}

/**
 * Troca o code do OAuth por um access_token do usuário.
 * O token expira em ~300s e é descartado após a descoberta do certificado.
 */
export async function exchangeBirdIdCode(opts: {
  code: string
  codeVerifier: string
  redirectUri: string
}): Promise<BirdIdToken> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: BIRDID_CLIENT_ID,
    client_secret: BIRDID_CLIENT_SECRET,
    code_verifier: opts.codeVerifier,
  })
  const res = await fetch(`${BIRDID_BASE_URL}/v0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.access_token) {
    throw new Error(data?.message ?? `Bird ID recusou a troca do code (HTTP ${res.status})`)
  }
  const cpf = String(data.authorized_identification ?? data.authorizedIdentification ?? "")
  if (!cpf) {
    throw new Error("Bird ID não retornou o CPF do titular autorizado")
  }
  return { accessToken: data.access_token, cpf }
}

export type BirdIdCertificate = {
  /** Alias do certificado na conta Bird ID. */
  alias: string
  /** Certificado X.509 em PEM. */
  certificate: string
}

/** Descobre o certificado em nuvem do titular (Bearer token do usuário). */
export async function discoverBirdIdCertificate(
  accessToken: string
): Promise<BirdIdCertificate> {
  const res = await fetch(`${BIRDID_BASE_URL}/v0/oauth/certificate-discovery`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.message ?? `Bird ID recusou a descoberta (HTTP ${res.status})`)
  }
  const certificate = String(data?.certificate ?? data?.certificates?.[0] ?? "")
  const alias = String(data?.alias ?? "")
  if (!certificate) {
    throw new Error("Bird ID não retornou o certificado do titular")
  }
  return { alias, certificate }
}

// ---------------------------------------------------------------------------
// Estado do OAuth (state + verifier) guardado em cookie httpOnly assinado.
// O verifier nunca sai do servidor; a assinatura HMAC impede adulteração e
// o vínculo com o userId impede reuso do cookie por outra sessão.
// ---------------------------------------------------------------------------

export type BirdIdOauthState = {
  state: string
  verifier: string
  userId: string
}

function getHmacKey(): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error("AUTH_SECRET não configurada no ambiente")
  }
  return Buffer.from(secret, "utf8")
}

/** Codifica e assina o estado do OAuth → valor do cookie "birdid_oauth". */
export function signBirdIdOauthState(data: BirdIdOauthState): string {
  const payload = base64Url(Buffer.from(JSON.stringify(data), "utf8"))
  const signature = createHmac("sha256", getHmacKey()).update(payload).digest("base64url")
  return `${payload}.${signature}`
}

/** Valida o cookie e devolve o estado; inválido/adulterado → null. */
export function verifyBirdIdOauthState(value: string | undefined): BirdIdOauthState | null {
  if (!value) return null
  const [payload, signature] = value.split(".")
  if (!payload || !signature) return null
  const expected = createHmac("sha256", getHmacKey()).update(payload).digest()
  const received = Buffer.from(signature, "base64url")
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    if (typeof data?.state !== "string" || typeof data?.verifier !== "string" || typeof data?.userId !== "string") {
      return null
    }
    return data as BirdIdOauthState
  } catch {
    return null
  }
}
