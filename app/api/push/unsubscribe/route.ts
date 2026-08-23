import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

/**
 * Remove a inscrição de Web Push do usuário logado.
 * Body: { endpoint }.
 */
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : ""

  if (endpoint) {
    await prisma.pushSubscription.deleteMany({
      where: { endpoint, userId: session.user.id },
    })
  }

  return NextResponse.json({ ok: true })
}
