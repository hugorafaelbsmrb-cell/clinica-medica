import { headers } from "next/headers"

/**
 * IP do cliente para envio ao gateway na análise antifraude do cartão.
 * Prefere o primeiro valor do x-forwarded-for (proxy/reverse proxy);
 * sem proxy, cai para o x-real-ip ou nada (o gateway usa o IP da conexão).
 */
export async function getClientIp(): Promise<string | undefined> {
  try {
    const h = await headers()
    const fwd = h.get("x-forwarded-for")
    const first = fwd?.split(",")[0]?.trim()
    return first || h.get("x-real-ip") || undefined
  } catch {
    return undefined
  }
}
