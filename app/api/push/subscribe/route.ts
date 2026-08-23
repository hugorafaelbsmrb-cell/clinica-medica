import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

/**
 * Registra (ou atualiza) a inscrição de Web Push do usuário logado.
 * Body: o retorno de `pushSubscription.toJSON()` — { endpoint, keys }.
 * O endpoint é único por navegador: se já existir de outro usuário,
 * passa a valer para o usuário atual (trocou de conta no mesmo celular).
 */
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : ""
  const keys = body?.keys as { p256dh?: unknown; auth?: unknown } | undefined

  if (
    !endpoint ||
    typeof keys?.p256dh !== "string" ||
    typeof keys?.auth !== "string"
  ) {
    return NextResponse.json({ error: "Inscrição inválida" }, { status: 400 })
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: {
      userId: session.user.id,
      keysJson: JSON.stringify({ p256dh: keys.p256dh, auth: keys.auth }),
    },
    create: {
      userId: session.user.id,
      endpoint,
      keysJson: JSON.stringify({ p256dh: keys.p256dh, auth: keys.auth }),
    },
  })

  return NextResponse.json({ ok: true })
}
