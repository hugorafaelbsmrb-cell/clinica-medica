"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, PlayCircle, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { listMediaAction } from "@/lib/actions/media"
import type { MediaFile } from "@/lib/media/storage"

/**
 * Picker de mídias do repositório: lista os arquivos do storage (imagem ou
 * vídeo, conforme o tipo), com miniatura e botão de upload direto.
 * Extraído do editor de jornadas para reuso no canvas de fluxos.
 */
export function MediaPicker({
  kind,
  onSelect,
}: {
  kind: "IMAGEM" | "VIDEO"
  onSelect: (file: { url: string; name: string }) => void
}) {
  const [files, setFiles] = useState<MediaFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    listMediaAction(kind === "IMAGEM" ? "image" : "video").then((result) => {
      if (cancelled) return
      if (result.success && result.files) setFiles(result.files)
      else setError(result.message ?? "Falha ao listar as mídias")
    })
    return () => {
      cancelled = true
    }
  }, [kind])

  async function handleUpload(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append("file", file)
      const response = await fetch("/api/media/upload", {
        method: "POST",
        body: form,
      })
      const data = (await response.json().catch(() => null)) as {
        url?: string
        error?: string
      } | null
      if (!response.ok || !data?.url) {
        setError(data?.error ?? "Falha no upload")
        return
      }
      onSelect({ url: data.url, name: file.name })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {kind === "IMAGEM" ? "Imagens" : "Vídeos"} do repositório
        </p>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={kind === "IMAGEM" ? "image/jpeg,image/png,image/webp,image/gif" : "video/mp4,video/quicktime,video/webm"}
            className="hidden"
            onChange={(event) => handleUpload(event.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Enviar nova
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!files && !error && (
        <p className="text-xs text-muted-foreground">Carregando mídias...</p>
      )}

      {files && files.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nenhuma {kind === "IMAGEM" ? "imagem" : "vídeo"} no repositório — use
          &quot;Enviar nova&quot; para subir a primeira.
        </p>
      )}

      {files && files.length > 0 && (
        <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
          {files.map((file) => (
            <button
              key={file.id}
              type="button"
              onClick={() => onSelect({ url: file.url, name: file.name })}
              className="group relative aspect-square overflow-hidden rounded-md border bg-muted text-left"
            >
              {file.type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={file.url}
                  alt={file.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center">
                  <PlayCircle className="h-8 w-8 text-muted-foreground" />
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                {file.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
