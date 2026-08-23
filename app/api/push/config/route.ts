import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"

export const dynamic = "force-dynamic"

/**
 * Devolve a chave pública VAPID para o navegador montar a inscrição
 * de Web Push. Servida por API (e não embutida no build) porque a VPS
 * injeta variáveis apenas em runtime (env_file do docker compose).
 */
export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  return NextResponse.json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? null })
}
