import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

/**
 * Sino de notificações do painel.
 * GET: lista as últimas notificações + contagem de não lidas.
 * POST: marca como lidas (body { ids: string[] } para itens
 * específicos; sem ids marca todas).
 */
export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const [unread, items] = await Promise.all([
    prisma.notification.count({ where: { readAt: null } }),
    prisma.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ])

  return NextResponse.json({
    unread,
    items: items.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      body: item.body,
      link: item.link,
      read: item.readAt !== null,
      createdAt: item.createdAt.toISOString(),
    })),
  })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((id: unknown) => typeof id === "string")
    : null

  await prisma.notification.updateMany({
    where: ids ? { id: { in: ids }, readAt: null } : { readAt: null },
    data: { readAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
