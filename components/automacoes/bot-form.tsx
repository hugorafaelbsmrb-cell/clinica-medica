"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Bot, MessageCircle } from "lucide-react"
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
  botPauseHours: number
  botMsgAtendente: string
  botMsgSaude: string
  botMsgCpfNaoEncontrado: string
  botMsgBoasVindas: string
  botMsgAgendar: string
}

/**
 * Configurações do bot — versão enxuta. Os textos das mensagens passaram a
 * viver no fluxo BOT do canvas; aqui ficam só o liga/desliga, a pausa e o
 * texto de "CPF não encontrado" (que o motor ainda usa). Os demais textos
 * seguem como campos ocultos para preservar os valores antigos no banco
 * (servem de fonte do seed de migração).
 */
export function BotForm({ initial }: { initial: BotInitialData }) {
  const router = useRouter()

  const [botEnabled, setBotEnabled] = useState(initial.botEnabled)
  const [pauseHours, setPauseHours] = useState(initial.botPauseHours)
  const [msgCpfNaoEncontrado, setMsgCpfNaoEncontrado] = useState(
    initial.botMsgCpfNaoEncontrado
  )

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
            <CardTitle>Configurações do bot</CardTitle>
            <CardDescription>
              Liga/desliga, pausa e aviso de CPF não encontrado — os textos
              das mensagens são editados no fluxo do bot logo abaixo
            </CardDescription>
          </div>
          <Badge variant={botEnabled ? "secondary" : "outline"}>
            {botEnabled ? "Ativo" : "Desativado"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
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

          {/* Pausa ao assumir o atendimento */}
          <Field>
            <FieldLabel className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-muted-foreground" />
              Pausa ao assumir o atendimento (horas)
            </FieldLabel>
            <input
              type="number"
              name="botPauseHours"
              min={1}
              max={168}
              value={pauseHours}
              onChange={(event) => setPauseHours(Number(event.target.value))}
              className="h-9 w-28 rounded-md border bg-background px-3 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Quando a equipe envia uma mensagem manual (ou o paciente pede
              um atendente), o bot e as mensagens automáticas ficam em
              silêncio para aquele número e voltam sozinhos depois desse
              prazo sem a equipe responder. Cada mensagem manual renova o
              prazo.
            </p>
          </Field>

          {/* CPF não encontrado */}
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

          {/* Textos antigos preservados (editados agora no canvas) */}
          <input
            type="hidden"
            name="botMsgBoasVindas"
            value={initial.botMsgBoasVindas}
          />
          <input
            type="hidden"
            name="botMsgAgendar"
            value={initial.botMsgAgendar}
          />
          <input
            type="hidden"
            name="botMsgAtendente"
            value={initial.botMsgAtendente}
          />
          <input
            type="hidden"
            name="botMsgSaude"
            value={initial.botMsgSaude}
          />

          <div className="flex gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar configurações"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
