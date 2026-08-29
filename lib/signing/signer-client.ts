/**
 * Cliente HTTP do microserviço de assinatura PAdES (PyHanko).
 *
 * O signer roda como serviço Docker na rede interna (sem porta exposta);
 * a aplicação Node envia o PDF + o .pfx já descriptografado + a senha e
 * recebe o PDF assinado. O material criptográfico existe em memória
 * apenas durante a requisição, tanto aqui quanto no signer.
 */

const SIGNER_URL =
  (process.env.SIGNER_URL || "http://127.0.0.1:8000").replace(/\/+$/, "")

export type CertificateInfo = {
  subject: string
  issuer: string
  serialNumber?: string
  validFrom: string
  validTo: string
  /** true quando a cadeia valida contra as ACs Raiz ICP-Brasil. */
  icpBrasil?: boolean
  chainMessage?: string
}

export type SignResult = {
  pdf: Buffer
  /** Nível PAdES efetivo: "B-LT" (carimbo + revogações) ou "B-B". */
  level: string
}

export type SignRequest = {
  pdf: Buffer
  pfx: Buffer
  password: string
  doctorName: string
  reason: string
  userId: string
}

async function postMultipart(
  path: string,
  fields: Record<string, string>,
  files: Record<string, { data: Buffer; filename: string }>
): Promise<Response> {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value)
  }
  for (const [key, file] of Object.entries(files)) {
    form.append(key, new Blob([new Uint8Array(file.data)]), file.filename)
  }
  return fetch(`${SIGNER_URL}${path}`, { method: "POST", body: form })
}

/** Verifica a saúde do microserviço (usado em Configurações). */
export async function checkSignerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${SIGNER_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Extrai sujeito/emissor/validade do certificado (upload). */
export async function inspectPfx(
  pfx: Buffer,
  password: string
): Promise<CertificateInfo> {
  const res = await postMultipart(
    "/inspect",
    { password },
    { pfx: { data: pfx, filename: "certificado.pfx" } }
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.subject) {
    throw new Error(body?.error ?? "Não foi possível ler o certificado")
  }
  return body as CertificateInfo
}

/** Assina o PDF com PAdES (B-LT com carimbo ICP quando possível, senão B-B). */
export async function signPdfWithSigner(input: SignRequest): Promise<SignResult> {
  const res = await postMultipart(
    "/sign",
    {
      password: input.password,
      doctorName: input.doctorName,
      reason: input.reason,
      userId: input.userId,
    },
    {
      pdf: { data: input.pdf, filename: "documento.pdf" },
      pfx: { data: input.pfx, filename: "certificado.pfx" },
    }
  )
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `Falha na assinatura (HTTP ${res.status})`)
  }
  const level = res.headers.get("x-signature-level") ?? "B-B"
  return { pdf: Buffer.from(await res.arrayBuffer()), level }
}
