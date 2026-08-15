"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Cake,
  HeartPulse,
  History,
  MapPinned,
  ThumbsUp,
  UserPlus,
  Wallet,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  saveMensagensAutomation,
  type AutomationState,
} from "@/lib/actions/automacoes"

export type MensagensInitialData = {
  autoCadastroEnabled: boolean
  autoCadastroDelayHours: number
  autoCadastroMsg: string
  autoTratamentoEnabled: boolean
  autoTratamentoIntervalDays: number
  autoTratamentoMsg: string
  autoAniversarioEnabled: boolean
  autoAniversarioMsg: string
  autoReativacaoEnabled: boolean
  autoReativacaoDays: number
  autoReativacaoMsg: string
  autoAgradecimentoEnabled: boolean
  autoAgradecimentoMsg: string
  autoACaminhoEnabled: boolean
  autoACaminhoMsg: string
  autoPagamentoLinkEnabled: boolean
  autoPagamentoLinkMsg: string
  autoPagamentoLembreteEnabled: boolean
  autoPagamentoLembreteDelayMinutes: number
  autoPagamentoLembreteMsg: string
  autoPagamentoConfirmadoEnabled: boolean
  autoPagamentoConfirmadoMsg: string
}

type SectionProps = {
  icon: React.ReactNode
  title: string
  description: string
  enabled: boolean
  onToggle: (value: boolean) => void
  fieldName: string
  children?: React.ReactNode
}

function Section({
  icon,
  title,
  description,
  enabled,
  onToggle,
  fieldName,
  children,
}: SectionProps) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border p-4 ${
        enabled ? "" : "opacity-70"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 font-medium">
            {icon}
            {title}
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          aria-label={title}
        />
        <input
          type="hidden"
          name={fieldName}
          value={enabled ? "on" : ""}
        />
      </div>
      {children}
    </div>
  )
}

export function MensagensForm({
  initial,
}: {
  initial: MensagensInitialData
}) {
  const router = useRouter()

  const [cadastroEnabled, setCadastroEnabled] = useState(
    initial.autoCadastroEnabled
  )
  const [cadastroDelay, setCadastroDelay] = useState(
    String(initial.autoCadastroDelayHours)
  )
  const [cadastroMsg, setCadastroMsg] = useState(initial.autoCadastroMsg)

  const [tratamentoEnabled, setTratamentoEnabled] = useState(
    initial.autoTratamentoEnabled
  )
  const [tratamentoInterval, setTratamentoInterval] = useState(
    String(initial.autoTratamentoIntervalDays)
  )
  const [tratamentoMsg, setTratamentoMsg] = useState(initial.autoTratamentoMsg)

  const [aniversarioEnabled, setAniversarioEnabled] = useState(
    initial.autoAniversarioEnabled
  )
  const [aniversarioMsg, setAniversarioMsg] = useState(initial.autoAniversarioMsg)

  const [reativacaoEnabled, setReativacaoEnabled] = useState(
    initial.autoReativacaoEnabled
  )
  const [reativacaoDays, setReativacaoDays] = useState(
    String(initial.autoReativacaoDays)
  )
  const [reativacaoMsg, setReativacaoMsg] = useState(initial.autoReativacaoMsg)

  const [agradecimentoEnabled, setAgradecimentoEnabled] = useState(
    initial.autoAgradecimentoEnabled
  )
  const [agradecimentoMsg, setAgradecimentoMsg] = useState(
    initial.autoAgradecimentoMsg
  )

  const [acaminhoEnabled, setAcaminhoEnabled] = useState(
    initial.autoACaminhoEnabled
  )
  const [acaminhoMsg, setAcaminhoMsg] = useState(initial.autoACaminhoMsg)

  const [pagamentoLinkEnabled, setPagamentoLinkEnabled] = useState(
    initial.autoPagamentoLinkEnabled
  )
  const [pagamentoLinkMsg, setPagamentoLinkMsg] = useState(
    initial.autoPagamentoLinkMsg
  )

  const [pagamentoLembreteEnabled, setPagamentoLembreteEnabled] = useState(
    initial.autoPagamentoLembreteEnabled
  )
  const [pagamentoLembreteDelay, setPagamentoLembreteDelay] = useState(
    String(initial.autoPagamentoLembreteDelayMinutes)
  )
  const [pagamentoLembreteMsg, setPagamentoLembreteMsg] = useState(
    initial.autoPagamentoLembreteMsg
  )

  const [pagamentoConfirmadoEnabled, setPagamentoConfirmadoEnabled] = useState(
    initial.autoPagamentoConfirmadoEnabled
  )
  const [pagamentoConfirmadoMsg, setPagamentoConfirmadoMsg] = useState(
    initial.autoPagamentoConfirmadoMsg
  )

  const [state, formAction, pending] = useActionState<
    AutomationState | null,
    FormData
  >(saveMensagensAutomation, null)

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message)
      router.refresh()
    } else if (state && !state.success) {
      toast.error(state.message)
    }
  }, [state, router])

  const anyEnabled =
    cadastroEnabled ||
    tratamentoEnabled ||
    aniversarioEnabled ||
    reativacaoEnabled ||
    agradecimentoEnabled ||
    acaminhoEnabled ||
    pagamentoLinkEnabled ||
    pagamentoLembreteEnabled ||
    pagamentoConfirmadoEnabled

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Mensagens automáticas</CardTitle>
            <CardDescription>
              Disparos automáticos para acompanhar e fidelizar os pacientes
            </CardDescription>
          </div>
          <Badge variant={anyEnabled ? "secondary" : "outline"}>
            {anyEnabled ? "Com automações ativas" : "Tudo desativado"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
          <p className="text-xs text-muted-foreground">
            As mensagens são verificadas a cada 10 minutos pelo agendador do
            sistema e enviadas só para pacientes com WhatsApp habilitado e
            consentimento LGPD. Use <code>{"{{nome}}"}</code> para incluir o
            primeiro nome do paciente. Vazio = usa o texto padrão.
          </p>

          <div className="flex flex-col gap-4">
            {/* 1) Cadastro incompleto */}
            <Section
              icon={<UserPlus className="h-4 w-4 text-primary" />}
              title="Cadastro incompleto"
              description="Quem iniciou o pré-cadastro online, informou o telefone e não finalizou. O lembrete sai depois do tempo definido abaixo."
              enabled={cadastroEnabled}
              onToggle={setCadastroEnabled}
              fieldName="autoCadastroEnabled"
            >
              <Field>
                <FieldLabel>Esperar (horas)</FieldLabel>
                <Input
                  name="autoCadastroDelayHours"
                  type="number"
                  min={1}
                  value={cadastroDelay}
                  onChange={(event) => setCadastroDelay(event.target.value)}
                  className="w-32"
                  inputMode="numeric"
                />
              </Field>
              <Field>
                <FieldLabel>Mensagem</FieldLabel>
                <Textarea
                  name="autoCadastroMsg"
                  value={cadastroMsg}
                  onChange={(event) => setCadastroMsg(event.target.value)}
                  rows={3}
                  placeholder="Olá {{nome}}! Percebemos que você começou seu cadastro... (padrão)"
                />
              </Field>
            </Section>

            {/* 2) Tratamento periódico */}
            <Section
              icon={<HeartPulse className="h-4 w-4 text-primary" />}
              title="Pacientes em tratamento (mensagem periódica)"
              description="Pacientes com consulta realizada nos últimos 90 dias recebem a mensagem a cada intervalo definido."
              enabled={tratamentoEnabled}
              onToggle={setTratamentoEnabled}
              fieldName="autoTratamentoEnabled"
            >
              <Field>
                <FieldLabel>A cada (dias)</FieldLabel>
                <Input
                  name="autoTratamentoIntervalDays"
                  type="number"
                  min={1}
                  value={tratamentoInterval}
                  onChange={(event) => setTratamentoInterval(event.target.value)}
                  className="w-32"
                  inputMode="numeric"
                />
              </Field>
              <Field>
                <FieldLabel>Mensagem</FieldLabel>
                <Textarea
                  name="autoTratamentoMsg"
                  value={tratamentoMsg}
                  onChange={(event) => setTratamentoMsg(event.target.value)}
                  rows={3}
                  placeholder="Olá {{nome}}! Esperamos que esteja tudo bem com você... (padrão)"
                />
              </Field>
            </Section>

            {/* 3) Aniversário */}
            <Section
              icon={<Cake className="h-4 w-4 text-primary" />}
              title="Aniversário"
              description="Enviada no dia do aniversário do paciente (no máximo uma vez por ano)."
              enabled={aniversarioEnabled}
              onToggle={setAniversarioEnabled}
              fieldName="autoAniversarioEnabled"
            >
              <Field>
                <FieldLabel>Mensagem</FieldLabel>
                <Textarea
                  name="autoAniversarioMsg"
                  value={aniversarioMsg}
                  onChange={(event) => setAniversarioMsg(event.target.value)}
                  rows={3}
                  placeholder="Olá {{nome}}! Feliz aniversário! Muita saúde... (padrão)"
                />
              </Field>
            </Section>

            {/* 4) Reativação */}
            <Section
              icon={<History className="h-4 w-4 text-primary" />}
              title="Reativação de clientes"
              description="Clientes com a última consulta há mais do que o período definido recebem um convite para voltar."
              enabled={reativacaoEnabled}
              onToggle={setReativacaoEnabled}
              fieldName="autoReativacaoEnabled"
            >
              <Field>
                <FieldLabel>Sem consulta há (dias)</FieldLabel>
                <Input
                  name="autoReativacaoDays"
                  type="number"
                  min={1}
                  value={reativacaoDays}
                  onChange={(event) => setReativacaoDays(event.target.value)}
                  className="w-32"
                  inputMode="numeric"
                />
              </Field>
              <Field>
                <FieldLabel>Mensagem</FieldLabel>
                <Textarea
                  name="autoReativacaoMsg"
                  value={reativacaoMsg}
                  onChange={(event) => setReativacaoMsg(event.target.value)}
                  rows={3}
                  placeholder="Olá {{nome}}! Faz um tempo que não nos vemos... (padrão)"
                />
              </Field>
            </Section>

            {/* 5) Agradecimento pós-consulta */}
            <Section
              icon={<ThumbsUp className="h-4 w-4 text-primary" />}
              title="Agradecimento pós-consulta"
              description="Enviada na hora em que o atendimento é marcado como realizado."
              enabled={agradecimentoEnabled}
              onToggle={setAgradecimentoEnabled}
              fieldName="autoAgradecimentoEnabled"
            >
              <Field>
                <FieldLabel>Mensagem</FieldLabel>
                <Textarea
                  name="autoAgradecimentoMsg"
                  value={agradecimentoMsg}
                  onChange={(event) => setAgradecimentoMsg(event.target.value)}
                  rows={3}
                  placeholder="Olá {{nome}}! Obrigado pela sua visita... (padrão)"
                />
              </Field>
            </Section>

            {/* 6) Médico a caminho */}
            <Section
              icon={<MapPinned className="h-4 w-4 text-primary" />}
              title="Médico a caminho"
              description="Avisa o paciente no momento em que o médico inicia o atendimento pelo módulo 'Atendimentos do dia'. Envio imediato, sem aguardar o agendador."
              enabled={acaminhoEnabled}
              onToggle={setAcaminhoEnabled}
              fieldName="autoACaminhoEnabled"
            >
              <Field>
                <FieldLabel>Mensagem</FieldLabel>
                <Textarea
                  name="autoACaminhoMsg"
                  value={acaminhoMsg}
                  onChange={(event) => setAcaminhoMsg(event.target.value)}
                  rows={3}
                  placeholder="Olá {{nome}}! O médico já está a caminho da sua casa. (padrão)"
                />
              </Field>
            </Section>

            {/* 7) Link de pagamento ao reservar */}
            <Section
              icon={<Wallet className="h-4 w-4 text-primary" />}
              title="Link de pagamento (agendamento online)"
              description="Enviada assim que o paciente reserva um horário com cobrança. Use {{valor}} e {{link}}."
              enabled={pagamentoLinkEnabled}
              onToggle={setPagamentoLinkEnabled}
              fieldName="autoPagamentoLinkEnabled"
            >
              <Field>
                <FieldLabel>Mensagem</FieldLabel>
                <Textarea
                  name="autoPagamentoLinkMsg"
                  value={pagamentoLinkMsg}
                  onChange={(event) => setPagamentoLinkMsg(event.target.value)}
                  rows={3}
                  placeholder="Olá {{nome}}! Reservamos seu horário. Pague R$ {{valor}} por aqui: {{link}} (padrão)"
                />
              </Field>
            </Section>

            {/* 8) Lembrete de pagamento pendente */}
            <Section
              icon={<Wallet className="h-4 w-4 text-amber-600" />}
              title="Lembrete de pagamento pendente"
              description="Aviso para quem reservou/cobrou e ainda não pagou. Sai depois do tempo definido abaixo (uma única vez por cobrança)."
              enabled={pagamentoLembreteEnabled}
              onToggle={setPagamentoLembreteEnabled}
              fieldName="autoPagamentoLembreteEnabled"
            >
              <Field>
                <FieldLabel>Esperar (minutos)</FieldLabel>
                <Input
                  name="autoPagamentoLembreteDelayMinutes"
                  type="number"
                  min={5}
                  value={pagamentoLembreteDelay}
                  onChange={(event) =>
                    setPagamentoLembreteDelay(event.target.value)
                  }
                  className="w-32"
                  inputMode="numeric"
                />
              </Field>
              <Field>
                <FieldLabel>Mensagem</FieldLabel>
                <Textarea
                  name="autoPagamentoLembreteMsg"
                  value={pagamentoLembreteMsg}
                  onChange={(event) =>
                    setPagamentoLembreteMsg(event.target.value)
                  }
                  rows={3}
                  placeholder="Olá {{nome}}! Falta o pagamento de R$ {{valor}} para confirmar. Pague por aqui: {{link}} (padrão)"
                />
              </Field>
            </Section>

            {/* 9) Pagamento confirmado */}
            <Section
              icon={<Wallet className="h-4 w-4 text-emerald-600" />}
              title="Pagamento confirmado"
              description="Enviada na hora em que o gateway confirma o pagamento (PIX, cartão ou Apple Pay)."
              enabled={pagamentoConfirmadoEnabled}
              onToggle={setPagamentoConfirmadoEnabled}
              fieldName="autoPagamentoConfirmadoEnabled"
            >
              <Field>
                <FieldLabel>Mensagem</FieldLabel>
                <Textarea
                  name="autoPagamentoConfirmadoMsg"
                  value={pagamentoConfirmadoMsg}
                  onChange={(event) =>
                    setPagamentoConfirmadoMsg(event.target.value)
                  }
                  rows={3}
                  placeholder="Olá {{nome}}! Recebemos seu pagamento de R$ {{valor}}. Tudo certo! (padrão)"
                />
              </Field>
            </Section>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar mensagens automáticas"}
            </Button>
            <Zap className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              As mudanças valem a partir do próximo ciclo (até 10 minutos).
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
