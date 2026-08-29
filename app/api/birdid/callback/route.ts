import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { encryptSecret } from "@/lib/signing/crypto"
import {
  birdIdConfigured,
  discoverBirdIdCertificate,
  exchangeBirdIdCode,
  getBirdIdRedirectUri,
  verifyBirdIdOauthState,
} from "@/lib/signing/birdid-client"
import { inspectCertPem } from "@/lib/signing/signer-client"

export const dynamic = "force-dynamic"

const BIRDID_OAUTH_COOKIE = "birdid_oauth"

function redirectResult(requestUrl: string, motivo?: string) {
  const url = new URL("/minha-assinatura", requestUrl)
  if (motivo) {
    url.searchParams.set("birdid", "erro")
    url.searchParams.set("motivo", motivo)
  } else {
    url.searchParams.set("birdid", "ok")
  }
  return NextResponse.redirect(url)
}

/**
 * Callback do OAuth Bird ID: valida state/verifier, troca o code por um
 * access_token de vida curta, descobre o certificado em nuvem, valida a
 * cadeia ICP-Brasil via signer (/inspect-pem) e salva o PEM criptografado
 * (AES-256-GCM). Recusa certificado fora da ICP (fail-closed).
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url)

  // O cookie é de uso único: em qualquer desfecho ele é apagado.
  const store = await cookies()
  const oauth = verifyBirdIdOauthState(store.get(BIRDID_OAUTH_COOKIE)?.value)
  store.delete({ name: BIRDID_OAUTH_COOKIE, path: "/api/birdid" })

  // Negado pelo usuário na tela do Bird ID.
  if (requestUrl.searchParams.get("error")) {
    return redirectResult(request.url, "negado")
  }

  if (!oauth) {
    return redirectResult(request.url, "sessao")
  }
  if (requestUrl.searchParams.get("state") !== oauth.state) {
    return redirectResult(request.url, "sessao")
  }

  const session = await auth()
  if (!session?.user || session.user.id !== oauth.userId) {
    return redirectResult(request.url, "sessao")
  }
  if (!birdIdConfigured()) {
    return redirectResult(request.url, "nao-configurado")
  }

  const code = requestUrl.searchParams.get("code")
  if (!code) {
    return redirectResult(request.url, "sessao")
  }

  try {
    // Troca o code → access_token (vida curta, descartado em seguida) e
    // descobre o certificado da conta Bird ID do titular.
    const token = await exchangeBirdIdCode({
      code,
      codeVerifier: oauth.verifier,
      redirectUri: getBirdIdRedirectUri(request.url),
    })
    const discovered = await discoverBirdIdCertificate(token.accessToken)

    // Só aceita certificado cuja cadeia valida contra as ACs Raiz ICP-Brasil.
    const info = await inspectCertPem(discovered.certificate)
    if (info.icpBrasil !== true) {
      console.warn(
        `[BirdID] Certificado recusado no onboarding (userId=${oauth.userId}): ${info.chainMessage}`
      )
      return redirectResult(request.url, "icp")
    }
    const validFrom = new Date(info.validFrom)
    const validTo = new Date(info.validTo)
    if (validTo <= new Date()) {
      return redirectResult(request.url, "vencido")
    }

    // Uma conexão ativa por usuário: desativa a anterior e grava a nova.
    await prisma.$transaction([
      prisma.birdIdCredential.updateMany({
        where: { userId: oauth.userId, status: "ACTIVE" },
        data: { status: "REVOKED" },
      }),
      prisma.birdIdCredential.create({
        data: {
          userId: oauth.userId,
          cpf: token.cpf,
          alias: discovered.alias || "certificado Bird ID",
          encryptedCertPem: encryptSecret(discovered.certificate),
          subject: info.subject,
          issuer: info.issuer,
          serialNumber: info.serialNumber ?? null,
          validFrom,
          validTo,
        },
      }),
      prisma.auditLog.create({
        data: {
          userId: oauth.userId,
          action: "CREATE",
          entity: "BirdIdCredential",
          details: { subject: info.subject, serialNumber: info.serialNumber },
        },
      }),
    ])

    return redirectResult(request.url)
  } catch (error) {
    console.error(
      `[BirdID] Falha no onboarding (userId=${oauth.userId}):`,
      error
    )
    return redirectResult(request.url, "servico")
  }
}
