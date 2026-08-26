"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ImagePlus, Loader2, MapPin, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  saveClinicSettings,
  getSignerStatus,
  geocodeClinicAddress,
  type ActionState,
} from "@/lib/actions/configuracoes"

export type ClinicInitialData = {
  name: string
  address?: string | null
  phone?: string | null
  email?: string | null
  cnpj?: string | null
  horarioAtendimento?: string | null
  logoDataUrl?: string | null
  enableDigitalSignature?: boolean
  consultaPresencialEnabled?: boolean
  consultaDomiciliarEnabled?: boolean
  consultaTeleconsultaEnabled?: boolean
  latitude?: number | null
  longitude?: number | null
  raioUrbanoKm?: number | null
}

const MAX_LOGO_BYTES = 1024 * 1024 // 1 MB

/** Linha de toggle dos métodos de consulta oferecidos no agendamento online. */
function MethodToggle({
  label,
  description,
  checked,
  onChange,
  inputName,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
  inputName: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b pb-3 last:border-b-0 last:pb-0">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
        <input type="hidden" name={inputName} value={checked ? "on" : ""} />
      </div>
    </div>
  )
}

export function ClinicaForm({ initial }: { initial: ClinicInitialData }) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [logo, setLogo] = useState(initial.logoDataUrl ?? "")
  const [digitalSignature, setDigitalSignature] = useState(
    initial.enableDigitalSignature ?? false
  )
  const [presencialEnabled, setPresencialEnabled] = useState(
    initial.consultaPresencialEnabled ?? true
  )
  const [domiciliarEnabled, setDomiciliarEnabled] = useState(
    initial.consultaDomiciliarEnabled ?? true
  )
  const [teleconsultaEnabled, setTeleconsultaEnabled] = useState(
    initial.consultaTeleconsultaEnabled ?? true
  )
  const [signerOk, setSignerOk] = useState<boolean | null>(null)
  const [address, setAddress] = useState(initial.address ?? "")
  const [latitude, setLatitude] = useState(
    initial.latitude != null ? String(initial.latitude).replace(".", ",") : ""
  )
  const [longitude, setLongitude] = useState(
    initial.longitude != null ? String(initial.longitude).replace(".", ",") : ""
  )
  const [raioUrbano, setRaioUrbano] = useState(
    initial.raioUrbanoKm != null
      ? String(initial.raioUrbanoKm).replace(".", ",")
      : "8"
  )
  const [geocoding, setGeocoding] = useState(false)

  useEffect(() => {
    getSignerStatus()
      .then((status) => setSignerOk(status.ok))
      .catch(() => setSignerOk(false))
  }, [])

  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    saveClinicSettings,
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

  function handleLogoSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    const isAllowed =
      file.type === "image/png" ||
      file.type === "image/jpeg" ||
      file.type === "image/jpg"
    if (!isAllowed) {
      toast.error("Use uma imagem PNG ou JPEG")
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Logo muito grande — use uma imagem de até 1 MB")
      return
    }

    const reader = new FileReader()
    reader.onload = () => setLogo(String(reader.result))
    reader.readAsDataURL(file)
  }

  // Busca as coordenadas da clínica pelo endereço (Nominatim) — referência
  // do cálculo do raio urbano no atendimento domiciliar.
  async function handleGeocodeClinic() {
    setGeocoding(true)
    try {
      const result = await geocodeClinicAddress(address || undefined)
      if (
        result.success &&
        result.latitude != null &&
        result.longitude != null
      ) {
        setLatitude(String(result.latitude).replace(".", ","))
        setLongitude(String(result.longitude).replace(".", ","))
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }
    } catch {
      toast.error("Não foi possível buscar as coordenadas")
    } finally {
      setGeocoding(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados da clínica</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
          <input type="hidden" name="logoDataUrl" value={logo} />

          {/* Logo */}
          <Field>
            <FieldLabel>Logo</FieldLabel>
            <div className="flex items-center gap-4">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logo}
                  alt="Logo da clínica"
                  className="h-16 w-16 rounded-lg border bg-background object-contain p-1"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
                  <ImagePlus className="h-6 w-6" />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={handleLogoSelected}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus className="h-4 w-4" />
                    Escolher imagem
                  </Button>
                  {logo && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setLogo("")}
                    >
                      <Trash2 className="h-4 w-4" />
                      Remover
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  PNG ou JPEG, até 1 MB. Aparece no menu lateral, na impressão e
                  nos PDFs enviados por WhatsApp.
                </p>
              </div>
            </div>
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Nome da clínica *</FieldLabel>
              <Input
                name="name"
                required
                minLength={2}
                defaultValue={initial.name}
                placeholder="Médico em Domicílio"
              />
            </Field>
            <Field>
              <FieldLabel>Telefone</FieldLabel>
              <Input
                name="phone"
                defaultValue={initial.phone ?? ""}
                placeholder="(11) 99999-0000"
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>E-mail</FieldLabel>
              <Input
                name="email"
                type="email"
                defaultValue={initial.email ?? ""}
                placeholder="contato@clinica.com"
              />
            </Field>
            <Field>
              <FieldLabel>CNPJ</FieldLabel>
              <Input
                name="cnpj"
                defaultValue={initial.cnpj ?? ""}
                placeholder="00.000.000/0000-00"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel>Endereço completo</FieldLabel>
            <Input
              name="address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Rua Exemplo, 123 — Centro, São Paulo/SP — CEP 00000-000"
            />
          </Field>

          {/* Localização da clínica — referência do raio urbano domiciliar */}
          <div className="flex flex-col gap-3 rounded-md border p-4">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-semibold">Localização da clínica</p>
              <p className="text-xs text-muted-foreground">
                Ponto de referência do raio urbano: o preço do atendimento
                domiciliar muda conforme a distância do paciente até aqui.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGeocodeClinic}
                disabled={geocoding}
              >
                {geocoding ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MapPin className="h-4 w-4" />
                )}
                Buscar coordenadas pelo endereço
              </Button>
              {latitude && longitude && (
                <Badge variant="secondary">
                  {latitude}, {longitude}
                </Badge>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>Latitude</FieldLabel>
                <Input
                  name="latitude"
                  type="text"
                  inputMode="decimal"
                  value={latitude}
                  onChange={(event) => setLatitude(event.target.value)}
                  placeholder="Ex.: -23,5505"
                />
              </Field>
              <Field>
                <FieldLabel>Longitude</FieldLabel>
                <Input
                  name="longitude"
                  type="text"
                  inputMode="decimal"
                  value={longitude}
                  onChange={(event) => setLongitude(event.target.value)}
                  placeholder="Ex.: -46,6333"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel>Raio urbano do atendimento domiciliar (km)</FieldLabel>
              <Input
                name="raioUrbanoKm"
                type="text"
                inputMode="decimal"
                value={raioUrbano}
                onChange={(event) => setRaioUrbano(event.target.value)}
                placeholder="Ex.: 8"
              />
              <p className="text-xs text-muted-foreground">
                Distância máxima para o preço domiciliar padrão; acima disso,
                vale o preço "fora do raio".
              </p>
            </Field>
            <p className="text-xs text-muted-foreground">
              Coordenadas em branco: o domiciliar usa um preço único (sem raio).
              O botão busca pelo endereço acima e salva na hora.
            </p>
          </div>

          <Field>
            <FieldLabel>Horário de atendimento</FieldLabel>
            <Textarea
              name="horarioAtendimento"
              defaultValue={initial.horarioAtendimento ?? ""}
              placeholder="Ex.: Segunda a sexta, das 8h às 17h"
              rows={2}
            />
            <p className="text-xs text-muted-foreground">
              Texto que o assistente virtual do WhatsApp responde quando
              perguntam o horário de funcionamento.
            </p>
          </Field>

          {/* Assinatura digital ICP-Brasil */}
          <div className="flex items-start justify-between gap-3 rounded-md border p-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Assinatura digital ICP-Brasil</p>
              <p className="text-xs text-muted-foreground">
                Assina prescrições e planos terapêuticos com o certificado
                digital A1 do médico (padrão PAdES, validade jurídica). O
                médico cadastra o certificado em "Minha assinatura".
              </p>
              {digitalSignature && (
                <div className="mt-1">
                  {signerOk === null ? (
                    <Badge variant="outline">Verificando serviço de assinatura…</Badge>
                  ) : signerOk ? (
                    <Badge variant="secondary">Serviço de assinatura online</Badge>
                  ) : (
                    <Badge variant="destructive">
                      Serviço de assinatura indisponível
                    </Badge>
                  )}
                </div>
              )}
            </div>
            <Switch
              checked={digitalSignature}
              onCheckedChange={(checked) => {
                setDigitalSignature(checked)
                if (checked && signerOk === null) {
                  getSignerStatus()
                    .then((status) => setSignerOk(status.ok))
                    .catch(() => setSignerOk(false))
                }
              }}
              aria-label="Assinatura digital ICP-Brasil"
            />
            <input
              type="hidden"
              name="enableDigitalSignature"
              value={digitalSignature ? "on" : ""}
            />
          </div>

          {/* Métodos de consulta no agendamento online */}
          <div className="flex flex-col gap-3 rounded-md border p-4">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-semibold">Métodos de consulta</p>
              <p className="text-xs text-muted-foreground">
                Quais modalidades o paciente pode escolher no agendamento
                online. A equipe continua podendo agendar qualquer tipo
                internamente.
              </p>
            </div>
            <MethodToggle
              label="Presencial (na clínica)"
              description="O paciente vai até a clínica no horário marcado."
              checked={presencialEnabled}
              onChange={setPresencialEnabled}
              inputName="consultaPresencialEnabled"
            />
            <MethodToggle
              label="Domiciliar (home care)"
              description="O médico atende na casa do paciente."
              checked={domiciliarEnabled}
              onChange={setDomiciliarEnabled}
              inputName="consultaDomiciliarEnabled"
            />
            <MethodToggle
              label="Teleconsulta (vídeo)"
              description="Consulta por videochamada — o link do Google Meet é
              enviado ao paciente na confirmação e no lembrete do dia."
              checked={teleconsultaEnabled}
              onChange={setTeleconsultaEnabled}
              inputName="consultaTeleconsultaEnabled"
            />
          </div>

          <div className="flex gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar configurações"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={pending}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
