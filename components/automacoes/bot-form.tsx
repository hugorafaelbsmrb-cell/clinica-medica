"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Bot,
  CalendarPlus,
  MessageCircle,
  ShieldAlert,
  Sparkles,
  UserRound,
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
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { saveBotSettings, type ActionState } from "@/lib/actions/configuracoes"

export type BotInitialData = {
  botEnabled: boolean
  botMsgAtendente: string
  botMsgSaude: string
  botMsgCpfNaoEncontrado: string
  botMsgBoasVindas: string
  botMsgAgendar: string
}

export function BotForm({ initial }: { initial: BotInitialData }) {
  const router = useRouter()

  const [botEnabled, setBotEnabled] = useState(initial.botEnabled)
  const [msgAtendente, setMsgAtendente] = useState(initial.botMsgAtendente)
  const [msgSaude, setMsgSaude] = useState(initial.botMsgSaude)
  const [msgCpfNaoEncontrado, setMsgCpfNaoEncontrado] = useState(
    initial.botMsgCpfNaoEncontrado
  )
  const [msgBoasVindas, setMsgBoasVindas] = useState(initial.botMsgBoasVindas)
  const [msgAgendar, setMsgAgendar] = useState(initial.botMsgAgendar)

  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    saveBotSettings,
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Bot de atendimento</CardTitle>
            <CardDescription>
              Respostas automáticas para quem escreve no WhatsApp da clínica
            </CardDescription>
          </div>
          <Badge variant={botEnabled ? "secondary" : "outline"}>
            {botEnabled ? "Ativo" : "Desativado"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
          <p className="text-xs text-muted-foreground">
            O bot responde sozinho no WhatsApp com um fluxo de atendimento:
            boas-vindas + menu (agendar, ver consulta, remarcar, endereço,
            horário, contato e falar com atendente). Envia o link de cadastro
            para novos agendamentos, consulta agendamentos pelo CPF do
            próprio número e avisa a equipe no painel quando alguém pede um
            atendente. Ele nunca dá orientação médica. Use{" "}
            <code>{"{{clinica}}"}</code> para incluir o nome da clínica
            cadastrado no sistema (Dados da clínica).
          </p>

          {/* Liga/desliga */}
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Bot ativo</p>
              <p className="text-xs text-muted-foreground">
                {botEnabled
                  ? "Respondendo automaticamente as mensagens recebidas."
                  : "Mensagens recebidas ficam registradas, mas sem resposta automática."}
              </p>
            </div>
            <Switch
              checked={botEnabled}
              onCheckedChange={(checked) => setBotEnabled(checked)}
              aria-label="Bot ativo"
            />
            <input
              type="hidden"
              name="botEnabled"
              value={botEnabled ? "on" : ""}
            />
          </div>

          {/* Mensagens personalizadas */}
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                Mensagem de boas-vindas
              </FieldLabel>
              <Textarea
                name="botMsgBoasVindas"
                value={msgBoasVindas}
                onChange={(event) => setMsgBoasVindas(event.target.value)}
                rows={3}
                placeholder='Olá! Sou o assistente virtual da {{clinica}}. Como posso ajudar? (padrão)'
              />
              <p className="text-xs text-muted-foreground">
                Saudação do início da conversa. O menu de opções aparece logo
                em seguida. Vazio = usa o texto padrão.
              </p>
            </Field>

            <Field>
              <FieldLabel className="flex items-center gap-2">
                <CalendarPlus className="h-4 w-4 text-muted-foreground" />
                Mensagem de novo agendamento
              </FieldLabel>
              <Textarea
                name="botMsgAgendar"
                value={msgAgendar}
                onChange={(event) => setMsgAgendar(event.target.value)}
                rows={3}
                placeholder='Para agendar sua consulta, é simples: 1. Acesse o link de cadastro... (padrão)'
              />
              <p className="text-xs text-muted-foreground">
                Enviada quando o paciente pede para agendar/marcar consulta.
                Vazio = usa o texto padrão com o link de cadastro.
              </p>
            </Field>

            <Field>
              <FieldLabel className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-muted-foreground" />
                Mensagem ao pedir atendente
              </FieldLabel>
              <Textarea
                name="botMsgAtendente"
                value={msgAtendente}
                onChange={(event) => setMsgAtendente(event.target.value)}
                rows={3}
                placeholder='Entendi! Vou avisar a nossa equipe e alguém vai falar com você em breve. (padrão)'
              />
              <p className="text-xs text-muted-foreground">
                A mensagem sempre marca a conversa como &quot;Pediu
                atendente&quot; no painel. Vazio = usa o texto padrão.
              </p>
            </Field>

            <Field>
              <FieldLabel className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                Mensagem de saúde (segurança)
              </FieldLabel>
              <Textarea
                name="botMsgSaude"
                value={msgSaude}
                onChange={(event) => setMsgSaude(event.target.value)}
                rows={3}
                placeholder='Não posso dar orientações de saúde por aqui — isso precisa ser avaliado por um profissional. (padrão)'
              />
              <p className="text-xs text-muted-foreground">
                Enviada quando a mensagem fala de dor, sintomas, remédio,
                exame etc. Vazio = usa o texto padrão.
              </p>
            </Field>

            <Field>
              <FieldLabel className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-muted-foreground" />
                Mensagem de CPF não encontrado
              </FieldLabel>
              <Textarea
                name="botMsgCpfNaoEncontrado"
                value={msgCpfNaoEncontrado}
                onChange={(event) => setMsgCpfNaoEncontrado(event.target.value)}
                rows={3}
                placeholder='Não encontrei um cadastro com este CPF. (padrão)'
              />
              <p className="text-xs text-muted-foreground">
                Enviada quando o paciente informa um CPF que não está
                cadastrado. Vazio = usa o texto padrão (com o link de
                cadastro).
              </p>
            </Field>
          </div>

          <div className="flex gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar bot"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
