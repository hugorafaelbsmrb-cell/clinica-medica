"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowDown,
  ArrowUp,
  Clock,
  Image as ImageIcon,
  Loader2,
  MessageSquareText,
  Pencil,
  PlayCircle,
  Plus,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { listMediaAction } from "@/lib/actions/media"
import type { MediaFile } from "@/lib/media/storage"
import {
  deleteJourney,
  saveJourney,
  toggleJourneyActive,
} from "@/lib/actions/journeys"

export type JourneyData = {
  id: string
  name: string
  description: string | null
  active: boolean
  steps: Array<{
    id: string
    position: number
    kind: "TEXTO" | "IMAGEM" | "VIDEO"
    content: string
    mediaUrl: string | null
    delayHours: number
  }>
}

type EditorStep = {
  kind: "TEXTO" | "IMAGEM" | "VIDEO"
  content: string
  mediaUrl: string | null
  delayValue: number
  delayUnit: "horas" | "dias"
}

const KIND_LABELS = { TEXTO: "Texto", IMAGEM: "Imagem", VIDEO: "Vídeo" } as const

/** Converte o atraso salvo (horas) para o par valor/unidade da tela. */
function toEditorStep(step: JourneyData["steps"][number]): EditorStep {
  if (step.delayHours > 0 && step.delayHours % 24 === 0) {
    return {
      kind: step.kind,
      content: step.content,
      mediaUrl: step.mediaUrl,
      delayValue: step.delayHours / 24,
      delayUnit: "dias",
    }
  }
  return {
    kind: step.kind,
    content: step.content,
    mediaUrl: step.mediaUrl,
    delayValue: step.delayHours,
    delayUnit: "horas",
  }
}

/**
 * Picker de mídias do repositório: lista os arquivos do storage (imagem ou
 * vídeo, conforme o passo), com miniatura e botão de upload direto.
 */
function MediaPicker({
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

function StepEditor({
  step,
  index,
  total,
  mediaConfigured,
  onChange,
  onRemove,
  onMove,
}: {
  step: EditorStep
  index: number
  total: number
  mediaConfigured: boolean
  onChange: (step: EditorStep) => void
  onRemove: () => void
  onMove: (direction: -1 | 1) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)

  function setKind(kind: EditorStep["kind"]) {
    if (kind !== "TEXTO" && !mediaConfigured) return
    onChange({ ...step, kind, mediaUrl: kind === "TEXTO" ? null : step.mediaUrl })
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-background p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-md bg-muted p-1">
          {(["TEXTO", "IMAGEM", "VIDEO"] as const).map((kind) => {
            const active = step.kind === kind
            const disabled = kind !== "TEXTO" && !mediaConfigured
            return (
              <button
                key={kind}
                type="button"
                onClick={() => setKind(kind)}
                disabled={disabled}
                className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground disabled:opacity-40"
                }`}
              >
                {kind === "TEXTO" ? (
                  <MessageSquareText className="h-3.5 w-3.5" />
                ) : kind === "IMAGEM" ? (
                  <ImageIcon className="h-3.5 w-3.5" />
                ) : (
                  <Video className="h-3.5 w-3.5" />
                )}
                {KIND_LABELS[kind]}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label="Mover passo para cima"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            aria-label="Mover passo para baixo"
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label="Remover passo"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        <span>Enviar</span>
        <Input
          type="number"
          min={0}
          max={step.delayUnit === "dias" ? 30 : 720}
          value={step.delayValue}
          onChange={(event) =>
            onChange({ ...step, delayValue: Number(event.target.value) })
          }
          className="h-7 w-20 px-2 text-xs"
        />
        <select
          value={step.delayUnit}
          onChange={(event) =>
            onChange({
              ...step,
              delayUnit: event.target.value as "horas" | "dias",
            })
          }
          className="h-7 rounded-md border bg-background px-2 text-xs"
        >
          <option value="horas">horas</option>
          <option value="dias">dias</option>
        </select>
        <span>
          {step.delayUnit === "dias" ? "dia(s)" : "hora(s)"}{" "}
          {index === 0
            ? "depois do início da jornada"
            : "depois da mensagem anterior"}
        </span>
      </div>

      {step.kind === "TEXTO" ? (
        <Field>
          <FieldLabel>Texto da mensagem</FieldLabel>
          <Textarea
            value={step.content}
            onChange={(event) =>
              onChange({ ...step, content: event.target.value })
            }
            placeholder="Escreva a mensagem que o paciente vai receber..."
            className="min-h-20"
          />
        </Field>
      ) : (
        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel>Legenda (opcional)</FieldLabel>
            <Textarea
              value={step.content}
              onChange={(event) =>
                onChange({ ...step, content: event.target.value })
              }
              placeholder="Legenda enviada junto com a mídia..."
              className="min-h-16"
            />
          </Field>

          {step.mediaUrl ? (
            <div className="flex items-center gap-3">
              {step.kind === "IMAGEM" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={step.mediaUrl}
                  alt="Mídia selecionada"
                  className="h-16 w-16 rounded-md border object-cover"
                />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-md border bg-muted">
                  <PlayCircle className="h-6 w-6 text-muted-foreground" />
                </span>
              )}
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPickerOpen((value) => !value)}
                >
                  Trocar {step.kind === "IMAGEM" ? "imagem" : "vídeo"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => onChange({ ...step, mediaUrl: null })}
                >
                  Remover mídia
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => setPickerOpen(true)}
              disabled={!mediaConfigured}
            >
              <ImageIcon className="h-4 w-4" />
              Escolher {step.kind === "IMAGEM" ? "imagem" : "vídeo"}
            </Button>
          )}

          {pickerOpen && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="absolute -top-1 right-0 z-10 rounded-full bg-muted p-1 text-muted-foreground hover:text-foreground"
                aria-label="Fechar seletor de mídias"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <MediaPicker
                kind={step.kind}
                onSelect={(file) => {
                  onChange({ ...step, mediaUrl: file.url })
                  setPickerOpen(false)
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function JornadasManager({
  journeys,
  mediaConfigured,
}: {
  journeys: JourneyData[]
  mediaConfigured: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<JourneyData | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [active, setActive] = useState(true)
  const [steps, setSteps] = useState<EditorStep[]>([])
  const [saving, startSaving] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [busy, startBusy] = useTransition()

  function openEditor(journey: JourneyData | null) {
    if (journey) {
      setEditing(journey)
      setIsNew(false)
      setName(journey.name)
      setDescription(journey.description ?? "")
      setActive(journey.active)
      setSteps(
        [...journey.steps]
          .sort((a, b) => a.position - b.position)
          .map(toEditorStep)
      )
    } else {
      setEditing(null)
      setIsNew(true)
      setName("")
      setDescription("")
      setActive(true)
      setSteps([
        { kind: "TEXTO", content: "", mediaUrl: null, delayValue: 0, delayUnit: "horas" },
      ])
    }
  }

  function closeEditor() {
    setEditing(null)
    setIsNew(false)
    setSteps([])
  }

  function addStep(kind: EditorStep["kind"]) {
    setSteps((current) => [
      ...current,
      { kind, content: "", mediaUrl: null, delayValue: 0, delayUnit: "horas" },
    ])
  }

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    form.set(
      "steps",
      JSON.stringify(
        steps.map((step) => ({
          kind: step.kind,
          content: step.content,
          mediaUrl: step.mediaUrl,
          delayHours:
            step.delayUnit === "dias" ? step.delayValue * 24 : step.delayValue,
        }))
      )
    )
    startSaving(async () => {
      const result = await saveJourney(null, form)
      if (result.success) {
        toast.success(result.message)
        router.refresh()
        closeEditor()
      } else {
        toast.error(result.message)
      }
    })
  }

  function handleToggle(journey: JourneyData) {
    setPendingId(journey.id)
    startBusy(async () => {
      const result = await toggleJourneyActive(journey.id)
      toast[result.success ? "success" : "error"](result.message)
      router.refresh()
      setPendingId(null)
    })
  }

  function handleDelete(journey: JourneyData) {
    if (!window.confirm(`Excluir a jornada "${journey.name}"?`)) return
    setPendingId(journey.id)
    startBusy(async () => {
      const result = await deleteJourney(journey.id)
      toast[result.success ? "success" : "error"](result.message)
      router.refresh()
      setPendingId(null)
    })
  }

  // ===== Editor =====
  if (editing || isNew) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {editing ? "Editar jornada" : "Nova jornada"}
          </CardTitle>
          <CardDescription>
            Monte a sequência de mensagens: cada bolha vira uma mensagem no
            WhatsApp do paciente, com o intervalo definido entre elas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            {editing && <input type="hidden" name="journeyId" value={editing.id} />}

            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>Nome da jornada *</FieldLabel>
                <Input
                  name="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ex.: Boas-vindas com vídeo"
                  required
                  minLength={3}
                />
              </Field>
              <Field>
                <FieldLabel>Descrição (opcional)</FieldLabel>
                <Input
                  name="description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Para a equipe identificar a jornada"
                />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="active"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
              />
              Jornada ativa (disponível para disparo)
            </label>

            {!mediaConfigured && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                A chave da API de mídias não está configurada — os passos de
                imagem e vídeo ficam desabilitados. Configure em Configurações
                → Integrações → Mídias (Storage).
              </p>
            )}

            <div className="flex flex-col gap-3">
              {steps.map((step, index) => (
                <StepEditor
                  key={index}
                  step={step}
                  index={index}
                  total={steps.length}
                  mediaConfigured={mediaConfigured}
                  onChange={(updated) =>
                    setSteps((current) =>
                      current.map((item, i) => (i === index ? updated : item))
                    )
                  }
                  onRemove={() =>
                    setSteps((current) => current.filter((_, i) => i !== index))
                  }
                  onMove={(direction) =>
                    setSteps((current) => {
                      const target = index + direction
                      if (target < 0 || target >= current.length) return current
                      const next = [...current]
                      ;[next[index], next[target]] = [next[target], next[index]]
                      return next
                    })
                  }
                />
              ))}

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Adicionar passo:
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addStep("TEXTO")}
                >
                  <Plus className="h-4 w-4" /> Texto
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!mediaConfigured}
                  onClick={() => addStep("IMAGEM")}
                >
                  <Plus className="h-4 w-4" /> Imagem
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!mediaConfigured}
                  onClick={() => addStep("VIDEO")}
                >
                  <Plus className="h-4 w-4" /> Vídeo
                </Button>
              </div>
            </div>

            <div className="flex gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Pencil className="h-4 w-4" />
                )}
                {saving ? "Salvando..." : "Salvar jornada"}
              </Button>
              <Button type="button" variant="ghost" onClick={closeEditor}>
                Cancelar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    )
  }

  // ===== Lista =====
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">Jornadas de mensagens</CardTitle>
          <CardDescription>
            Sequências de texto, imagem e vídeo disparadas manualmente por
            paciente (painel WhatsApp → Enviar manual).
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => openEditor(null)}>
          <Plus className="h-4 w-4" /> Nova jornada
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {journeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma jornada criada ainda. Monte a primeira: por exemplo,
            texto de boas-vindas → imagem → vídeo, com intervalos entre eles.
          </p>
        ) : (
          journeys.map((journey) => (
            <div
              key={journey.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{journey.name}</p>
                  <Badge variant={journey.active ? "secondary" : "outline"}>
                    {journey.active ? "Ativa" : "Inativa"}
                  </Badge>
                  <Badge variant="outline">
                    {journey.steps.length}{" "}
                    {journey.steps.length === 1 ? "passo" : "passos"}
                  </Badge>
                </div>
                {journey.description && (
                  <p className="text-xs text-muted-foreground">
                    {journey.description}
                  </p>
                )}
                <p className="truncate text-xs text-muted-foreground">
                  {[...journey.steps]
                    .sort((a, b) => a.position - b.position)
                    .map((step) => KIND_LABELS[step.kind])
                    .join(" → ")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pendingId === journey.id}
                  onClick={() => handleToggle(journey)}
                >
                  {journey.active ? "Desativar" : "Ativar"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pendingId === journey.id}
                  onClick={() => openEditor(journey)}
                >
                  <Pencil className="h-4 w-4" /> Editar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pendingId === journey.id}
                  onClick={() => handleDelete(journey)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))
        )}
        {busy && pendingId && (
          <p className="text-xs text-muted-foreground">Atualizando...</p>
        )}
      </CardContent>
    </Card>
  )
}
