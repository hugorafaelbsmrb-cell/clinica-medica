"use client"

/**
 * Formulário de campanha de marketing (criar/editar, só ADMIN).
 * Upload local da imagem (data URL, até 2 MB), prévia da audiência
 * via server action e salvamento como rascunho ou agendamento.
 */
import { useEffect, useRef, useState, useTransition } from "react"
import { useActionState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ImagePlus, Loader2, Sparkles, Trash2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  createMarketingCampaign,
  updateMarketingCampaign,
  previewMarketingAudience,
  generateMarketingMessage,
  type MarketingActionState,
} from "@/lib/actions/marketing"
import { TONE_LABELS } from "@/lib/marketing/labels"
import type { DoctorOption } from "@/lib/doctor"

const MAX_IMAGE_BYTES = 2 * 1024 * 1024 // 2 MB

export type CampaignInitialData = {
  id?: string
  name: string
  tone: string
  body: string
  linkUrl: string
  imageDataUrl: string
  scheduledAt: string
  audienceKind: string
  audienceDoctorId: string
  audienceDays: string
  status?: string
}

/** Data/hora local no formato do input datetime-local (Brasília). */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function CampaignForm({
  initial,
  doctors,
}: {
  initial?: CampaignInitialData
  doctors: DoctorOption[]
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(initial?.name ?? "")
  const [tone, setTone] = useState(initial?.tone ?? "informativo")
  const [body, setBody] = useState(initial?.body ?? "")
  const [linkUrl, setLinkUrl] = useState(initial?.linkUrl ?? "")
  const [image, setImage] = useState(initial?.imageDataUrl ?? "")
  const [scheduledAt, setScheduledAt] = useState(
    initial?.scheduledAt || toLocalInput(new Date(Date.now() + 60 * 60 * 1000))
  )
  const [audienceKind, setAudienceKind] = useState(
    initial?.audienceKind ?? "TODOS"
  )
  const [audienceDoctorId, setAudienceDoctorId] = useState(
    initial?.audienceDoctorId ?? ""
  )
  const [audienceDays, setAudienceDays] = useState(initial?.audienceDays ?? "90")
  const [asDraft, setAsDraft] = useState(false)

  // Geração da mensagem com IA (DeepSeek): diálogo com o tema.
  const [aiOpen, setAiOpen] = useState(false)
  const [aiTopic, setAiTopic] = useState("")
  const [generating, setGenerating] = useState(false)

  // Prévia da audiência (server action) com debounce simples.
  const [audienceCount, setAudienceCount] = useState<number | null>(null)
  const [previewing, startPreview] = useTransition()
  useEffect(() => {
    const timer = setTimeout(() => {
      startPreview(async () => {
        const result = await previewMarketingAudience({
          kind: audienceKind,
          doctorId: audienceKind === "MEDICO" ? audienceDoctorId : null,
          days: audienceKind === "ATIVOS" ? Number(audienceDays) || 0 : null,
        })
        setAudienceCount(result.ok ? (result.count ?? null) : null)
      })
    }, 400)
    return () => clearTimeout(timer)
  }, [audienceKind, audienceDoctorId, audienceDays])

  const action = initial?.id ? updateMarketingCampaign : createMarketingCampaign
  const [state, formAction, pending] = useActionState<MarketingActionState | null, FormData>(
    action,
    null
  )

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message)
      router.refresh()
    } else if (state && !state.success) {
      toast.error(state.message)
    }
  }, [state, router])

  function handleImageFile(file: File | undefined) {
    if (!file) return
    const isAllowed = file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/jpg"
    if (!isAllowed) {
      toast.error("Use uma imagem PNG ou JPEG")
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("Imagem muito grande — use uma imagem de até 2 MB")
      return
    }
    const reader = new FileReader()
    reader.onload = () => setImage(String(reader.result))
    reader.readAsDataURL(file)
  }

  async function handleGenerateMessage() {
    const topic = aiTopic.trim()
    if (topic.length < 3) {
      toast.error("Descreva o tema da mensagem antes de gerar")
      return
    }

    setGenerating(true)
    try {
      const result = await generateMarketingMessage({
        tone,
        topic,
        linkUrl: linkUrl || null,
        currentMessage: body || null,
      })
      if (result.success && result.content) {
        setBody(result.content)
        setAiOpen(false)
        setAiTopic("")
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }
    } catch {
      toast.error("Falha ao gerar a mensagem — tente novamente")
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {initial?.id ? "Editar campanha" : "Nova campanha"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Nome da campanha *</FieldLabel>
              <Input
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Aviso de novo horário"
                required
              />
            </Field>
            <Field>
              <FieldLabel>Tom da mensagem</FieldLabel>
              <select
                name="tone"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                {Object.entries(TONE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field>
            <FieldLabel>Mensagem *</FieldLabel>
            <Textarea
              name="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Olá {{nome}}! Temos uma novidade para você..."
              rows={5}
              required
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Use {"{{nome}}"} para o primeiro nome do paciente e{" "}
                {"{{clinica}}"} para o nome da clínica — cada mensagem
                sai personalizada.
              </p>
              <Button
                type="button"
                variant="outline"
                className="h-9"
                onClick={() => setAiOpen(true)}
              >
                <Sparkles className="h-4 w-4" />
                Gerar mensagem com IA
              </Button>
            </div>
          </Field>

          {/* Imagem opcional (upload local, data URL no banco — como a logo). */}
          <Field>
            <FieldLabel>Imagem (opcional)</FieldLabel>
            <div className="flex items-center gap-4">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt="Imagem da campanha"
                  className="h-20 w-20 rounded-md border object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed text-muted-foreground">
                  <ImagePlus className="h-6 w-6" />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus className="h-4 w-4" />
                    {image ? "Trocar imagem" : "Enviar imagem"}
                  </Button>
                  {image && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9"
                      onClick={() => {
                        setImage("")
                        if (fileInputRef.current) fileInputRef.current.value = ""
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      Remover
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  PNG ou JPEG, até 2 MB. Sem imagem, a campanha sai só em texto.
                </p>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => handleImageFile(e.target.files?.[0])}
            />
            <input type="hidden" name="imageDataUrl" value={image} />
          </Field>

          <Field>
            <FieldLabel>Link (opcional)</FieldLabel>
            <Input
              name="linkUrl"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://..."
              type="url"
            />
            <p className="text-xs text-muted-foreground">
              O link entra no final da mensagem.
            </p>
          </Field>

          <Field>
            <FieldLabel>Público *</FieldLabel>
            <div className="grid gap-3 md:grid-cols-3">
              <select
                name="audienceKind"
                value={audienceKind}
                onChange={(e) => setAudienceKind(e.target.value)}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="TODOS">Todos os pacientes</option>
                <option value="MEDICO">Pacientes por médico</option>
                <option value="ATIVOS">Ativos nos últimos N dias</option>
                <option value="LEADS">Leads (ainda não são pacientes)</option>
              </select>
              {audienceKind === "MEDICO" && (
                <select
                  name="audienceDoctorId"
                  value={audienceDoctorId}
                  onChange={(e) => setAudienceDoctorId(e.target.value)}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">Selecione o médico...</option>
                  {doctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.name}
                      {doctor.crm ? ` — ${doctor.crm}` : ""}
                    </option>
                  ))}
                </select>
              )}
              {audienceKind === "ATIVOS" && (
                <Input
                  name="audienceDays"
                  type="number"
                  min={1}
                  max={3650}
                  value={audienceDays}
                  onChange={(e) => setAudienceDays(e.target.value)}
                  placeholder="Dias (ex.: 90)"
                />
              )}
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5 shrink-0" />
              {previewing ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> Contando público...
                </span>
              ) : audienceCount === null ? (
                audienceKind === "LEADS"
                  ? "Público: leads capturados pelo bot que ainda não viraram pacientes"
                  : "Público: pacientes com WhatsApp, telefone e consentimento LGPD"
              ) : (
                `Público estimado: ${audienceCount} ${
                  audienceKind === "LEADS"
                    ? audienceCount === 1
                      ? "lead"
                      : "leads"
                    : `paciente${audienceCount === 1 ? "" : "s"}`
                }`
              )}
            </p>
          </Field>

          {!asDraft && (
            <Field>
              <FieldLabel>Data e hora do envio *</FieldLabel>
              <Input
                type="datetime-local"
                name="scheduledAt"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                O envio começa em até 10 minutos após este horário (ciclo do
                cron) e segue em lotes de 50 mensagens.
              </p>
            </Field>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={asDraft}
              onChange={(e) => setAsDraft(e.target.checked)}
              className="h-4 w-4 rounded border"
            />
            Salvar como rascunho (não enviar ainda)
            <input type="hidden" name="asDraft" value={asDraft ? "on" : ""} />
          </label>

          <div className="flex gap-3">
            <Button type="submit" disabled={pending || previewing}>
              {pending
                ? "Salvando..."
                : initial?.id
                  ? "Salvar alterações"
                  : asDraft
                    ? "Salvar rascunho"
                    : "Agendar campanha"}
            </Button>
            {initial?.id && (
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/marketing")}
              >
                Cancelar edição
              </Button>
            )}
          </div>
        </form>

        {/* Diálogo da geração com IA: o tema vira prompt para a DeepSeek. */}
        <Dialog open={aiOpen} onOpenChange={setAiOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Gerar mensagem com IA</DialogTitle>
              <DialogDescription>
                Descreva o tema da campanha (ex.: "campanha de vacinação contra
                a gripe para pacientes acima de 60 anos"). A DeepSeek escreve a
                mensagem no tom {TONE_LABELS[tone]?.toLowerCase() ?? tone} e
                preenche o campo Mensagem — revise antes de agendar.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={aiTopic}
              onChange={(e) => setAiTopic(e.target.value)}
              placeholder="Tema ou ideia da campanha..."
              rows={4}
              autoFocus
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAiOpen(false)}
                disabled={generating}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleGenerateMessage}
                disabled={generating}
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Gerando...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Gerar mensagem
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
