/**
 * Criptografia simétrica dos certificados A1 em repouso.
 *
 * O .pfx/.p12 e a senha ficam no banco criptografados com AES-256-GCM.
 * A chave (CERT_ENCRYPTION_KEY) vive apenas no ambiente (.env), fora do
 * banco — vazamento do banco não expõe o material criptográfico.
 *
 * Formato do texto armazenado: base64(iv).base64(tag).base64(cipher),
 * 12 bytes de IV aleatório por operação (96 bits, padrão GCM).
 */
import crypto from "node:crypto"

function getKey(): Buffer {
  const raw = process.env.CERT_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      "CERT_ENCRYPTION_KEY não configurada no ambiente (necessária para certificados digitais)"
    )
  }
  // Aceita a chave em hex (64 chars → 32 bytes) ou em base64 (44 chars → 32 bytes).
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64")
  if (key.length !== 32) {
    throw new Error("CERT_ENCRYPTION_KEY deve ter 32 bytes (hex de 64 chars ou base64)")
  }
  return key
}

/** Criptografa um Buffer/string e devolve "iv.tag.cipher" (tudo base64). */
export function encryptSecret(plain: Buffer | string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv)
  const encrypted = Buffer.concat([
    cipher.update(typeof plain === "string" ? Buffer.from(plain, "utf8") : plain),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`
}

/** Decifra "iv.tag.cipher" e devolve o Buffer original. */
export function decryptSecret(stored: string): Buffer {
  const [ivB64, tagB64, cipherB64] = stored.split(".")
  if (!ivB64 || !tagB64 || !cipherB64) {
    throw new Error("Dado criptografado em formato inválido")
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(ivB64, "base64")
  )
  decipher.setAuthTag(Buffer.from(tagB64, "base64"))
  return Buffer.concat([
    decipher.update(Buffer.from(cipherB64, "base64")),
    decipher.final(),
  ])
}
