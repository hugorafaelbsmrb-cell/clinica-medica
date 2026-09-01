import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { uploadMedia } from "@/lib/media/storage"

export const runtime = "nodejs"

// Tipos aceitos (imagem e vídeo) e limite do storage (50 MB).
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
])
const MAX_BYTES = 50 * 1024 * 1024

/**
 * Upload de mídia para o repositório (storage das jornadas de mensagens).
 * Recebe multipart FormData com o campo "file". Usa route handler (e não
 * server action) porque o Next limita o body de server actions a ~1 MB —
 * aqui o limite é o do storage (50 MB).
 */
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get("file")
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 })
  }

  const type = (file.type || "").toLowerCase()
  if (!ALLOWED_TYPES.has(type)) {
    return NextResponse.json(
      {
        error:
          "Tipo de arquivo não suportado — envie JPEG, PNG, WebP, GIF, MP4, MOV ou WebM",
      },
      { status: 400 }
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Arquivo acima do limite de 50 MB" },
      { status: 400 }
    )
  }

  try {
    const result = await uploadMedia(file, file.name, type)
    return NextResponse.json({ url: result.url })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha no upload para o storage",
      },
      { status: 502 }
    )
  }
}
