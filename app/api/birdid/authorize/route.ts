import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomBytes } from "node:crypto"
import { auth } from "@/lib/auth"
import {
  birdIdConfigured,
  buildBirdIdAuthorizeUrl,
  computeCodeChallenge,
  generateCodeVerifier,
  getBirdIdRedirectUri,
  signBirdIdOauthState,
} from "@/lib/signing/birdid-client"

export const dynamic = "force-dynamic"

const BIRDID_OAUTH_COOKIE = "birdid_oauth"

function failRedirect(requestUrl: string, motivo: string) {
  const url = new URL("/minha-assinatura", requestUrl)
  url.searchParams.set("birdid", "erro")
  url.searchParams.set("motivo", motivo)
  return NextResponse.redirect(url)
}

/**
 * Início do onboarding Bird ID: guarda state + verifier (PKCE) em cookie
 * httpOnly assinado e redireciona o médico para o login do Bird ID, com
 * login_hint = CPF informado. O verifier nunca sai do servidor.
 */
export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", request.url))
  }
  if (!["ADMIN", "MEDICO"].includes(session.user.role)) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }
  if (!birdIdConfigured()) {
    return failRedirect(request.url, "nao-configurado")
  }

  const cpf = (new URL(request.url).searchParams.get("cpf") || "").replace(/\D/g, "")
  if (cpf && cpf.length !== 11) {
    return failRedirect(request.url, "cpf")
  }

  const state = randomBytes(24).toString("hex")
  const verifier = generateCodeVerifier()
  const redirectUri = getBirdIdRedirectUri(request.url)
  const authorizeUrl = buildBirdIdAuthorizeUrl({
    state,
    codeChallenge: computeCodeChallenge(verifier),
    redirectUri,
    loginHint: cpf || undefined,
  })

  const cookieValue = signBirdIdOauthState({
    state,
    verifier,
    userId: session.user.id,
  })

  const store = await cookies()
  store.set(BIRDID_OAUTH_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/birdid",
    maxAge: 600,
  })

  return NextResponse.redirect(authorizeUrl)
}
