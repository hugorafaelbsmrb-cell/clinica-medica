"use server"

import { auth } from "@/lib/auth"
import { deleteMedia, listMediaFiles, type MediaFile } from "@/lib/media/storage"

export type MediaListResult = {
  success: boolean
  message?: string
  files?: MediaFile[]
}

/** Lista as mídias do repositório para o picker do editor de jornadas. */
export async function listMediaAction(
  type?: "image" | "video"
): Promise<MediaListResult> {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return { success: false, message: "Apenas administradores" }
  }

  try {
    const files = await listMediaFiles(type)
    return { success: true, files }
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Falha ao listar as mídias",
    }
  }
}

/** Remove uma mídia do repositório (só ADMIN). */
export async function deleteMediaAction(id: number): Promise<{
  success: boolean
  message: string
}> {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return { success: false, message: "Apenas administradores" }
  }

  try {
    await deleteMedia(id)
    return { success: true, message: "Mídia removida" }
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Falha ao remover a mídia",
    }
  }
}
