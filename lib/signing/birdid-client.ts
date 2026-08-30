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
 * signer, que recebe as credenciais da aplicação por requisição.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { decryptSecret } from "./crypto"

/** Ambientes oficiais da API pública do Bird ID (seletor no painel). */
export const BIRDID_BASE_URLS = {
  homologacao: "https://apihom.birdid.com.br",
  producao: "https://api.birdid.com.br",
} as const

export type BirdIdConfig = {
  baseUrl: string
  clientId: string
  clientSecret: string
}

/**
 * Resolve a configuração do Bird ID: banco primeiro (tela Configurações →
 * Integrações), .env como fallback. O client_secret fica criptografado no
 * banco (AES-256-GCM) e é decifrado só aqui, em memória.
 */
export async function getBirdIdConfig(): Promise<BirdIdConfig> {
  const settings = await prisma.clinicSettings.findUnique({ where: { id: 1 } })
  const baseUrl = (
    settings?.birdIdBaseUrl ||
    process.env.BIRDID_BASE_URL ||
    BIRDID_BASE_URLS.producao
  ).replace(/\/+$/, "")
  const clientId = settings?.birdIdClientId || process.env.BIRDID_CLIENT_ID || ""
  let clientSecret = process.env.BIRDID_CLIENT_SECRET || ""
  if (settings?.birdIdClientSecretEnc) {
    try {
      clientSecret = decryptSecret(settings.birdIdClientSecretEnc).toString("utf8")
    } catch (error) {
      console.warn("[BirdID] Falha ao decifrar o client_secret do banco:", error)
    }
  }
  return { baseUrl, clientId, clientSecret }
}

/** True quando as credenciais do console Bird ID estão configuradas. */
export async function birdIdConfigured(): Promise<boolean> {
  const config = await getBirdIdConfig()
  return Boolean(config.clientId && config.clientSecret)
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
export async function buildBirdIdAuthorizeUrl(opts: {
  state: string
  codeChallenge: string
  redirectUri: string
  loginHint?: string
}): Promise<string> {
  const config = await getBirdIdConfig()
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: opts.redirectUri,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    scope: "authentication_session",
    state: opts.state,
    lifetime: "300",
  })
  if (opts.loginHint) params.set("login_hint", opts.loginHint)
  return `${config.baseUrl}/v0/oauth/authorize?${params.toString()}`
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
  const config = await getBirdIdConfig()
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: opts.codeVerifier,
  })
  const res = await fetch(`${config.baseUrl}/v0/oauth/token`, {
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
  const config = await getBirdIdConfig()
  const res = await fetch(`${config.baseUrl}/v0/oauth/certificate-discovery`, {
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
// Sessão de assinatura (OAuth2 Password + OTP do app).
// O médico digita o código de 6 dígitos exibido no app Bird ID e o sistema
// abre uma sessão signature_session: as assinaturas seguintes saem em
// silêncio (POST /v0/oauth/signature), sem push por documento, enquanto o
// token valer. O token é guardado criptografado e nunca vai para o cliente.
// ---------------------------------------------------------------------------

/** Validade da sessão de assinatura (env BIRDID_SESSION_LIFETIME, segundos). */
export function getBirdIdSessionLifetime(): number {
  const raw = Number(process.env.BIRDID_SESSION_LIFETIME)
  const value = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 28_800 // 8h
  // Limite do Bird ID para pessoa física: 7 dias (604800s).
  return Math.min(Math.max(value, 300), 604_800)
}

export type BirdIdSessionToken = {
  accessToken: string
  expiresIn: number
  scope: string
}

/**
 * Abre uma sessão de assinatura com o OTP do app Bird ID.
 * Erro 401/400 → código inválido ou expirado; erro de escopo → o Wings não
 * liberou signature_session para a aplicação.
 */
export async function openBirdIdOtpSession(opts: {
  cpf: string
  otp: string
}): Promise<BirdIdSessionToken> {
  const config = await getBirdIdConfig()
  const body = {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    username: opts.cpf,
    password: opts.otp,
    grant_type: "password",
    scope: "signature_session",
    lifetime: getBirdIdSessionLifetime(),
  }
  const res = await fetch(`${config.baseUrl}/v0/oauth/pwd_authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.access_token) {
    if (res.status === 401 || res.status === 400 || res.status === 403) {
      throw new Error(
        "Código OTP inválido ou expirado — confira o código exibido no app Bird ID"
      )
    }
    throw new Error(data?.message ?? `Bird ID recusou a abertura da sessão (HTTP ${res.status})`)
  }
  const accessToken = String(data.access_token)
  const expiresIn = Number(data.expires_in)
  const scope = String(data.scope ?? "")
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("Bird ID retornou uma sessão sem validade")
  }
  if (!scope.split(/\s+/).includes("signature_session")) {
    throw new Error(
      "A permissão de assinatura por sessão não está liberada para esta aplicação (Wings)"
    )
  }
  return { accessToken, expiresIn, scope }
}

/** Revoga a sessão no Bird ID (best-effort; falha não impede o encerramento). */
export async function revokeBirdIdSession(accessToken: string): Promise<void> {
  try {
    const config = await getBirdIdConfig()
    await fetch(`${config.baseUrl}/v0/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: accessToken }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    console.warn("[BirdID] Falha ao revogar a sessão no Bird ID:", error)
  }
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
