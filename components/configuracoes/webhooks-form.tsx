"use client"

import { toast } from "sonner"
import { Copy, CreditCard, MessageCircle, Webhook } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export type WebhookInitialData = {
  whatsappWebhookUrl: string
  asaasWebhookUrl: string
  stripeWebhookUrl: string
}

/**
 * Seção consolidada de webhooks do painel admin: mostra os endereços
 * que os serviços externos (W-API, Asaas e Stripe) usam para avisar o
 * sistema. Os endereços acompanham o domínio configurado na VPS —
 * aqui é o ponto único para consultar e copiar na hora de configurar
 * ou reconfigurar os painéis externos.
 */
export function WebhooksForm({ initial }: { initial: WebhookInitialData }) {
  async function handleCopy(url: string, label: string) {
    // Fallback para navegadores sem Clipboard API em contexto não seguro (HTTP).
    async function legacyCopy() {
      const textarea = document.createElement("textarea")
      textarea.value = url
      textarea.style.position = "fixed"
      textarea.style.opacity = "0"
      document.body.appendChild(textarea)
      textarea.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(textarea)
      if (!ok) throw new Error("copy failed")
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      } else {
        await legacyCopy()
      }
      toast.success(`${label} copiado`)
    } catch {
      toast.error("Não foi possível copiar — selecione o endereço manualmente")
    }
  }

  const items = [
    {
      icon: MessageCircle,
      label: "WhatsApp (W-API)",
      url: initial.whatsappWebhookUrl,
      hint: "Painel da W-API → Webhook → cole no campo \"Ao receber uma mensagem\".",
    },
    {
      icon: CreditCard,
      label: "Asaas",
      url: initial.asaasWebhookUrl,
      hint: "Painel do Asaas → Configurações → Webhooks. Eventos de pagamento (RECEIVED/CONFIRMED/OVERDUE) chegam por aqui.",
    },
    {
      icon: Webhook,
      label: "Stripe",
      url: initial.stripeWebhookUrl,
      hint: "Dashboard do Stripe → Developers → Webhooks → Add endpoint.",
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhooks</CardTitle>
        <CardDescription>
          Endereços que os serviços externos usam para avisar o sistema sobre
          mensagens e pagamentos. Eles acompanham o domínio do sistema
          automaticamente — copie aqui na hora de configurar cada painel.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {items.map(({ icon: Icon, label, url, hint }) => (
            <div key={label} className="flex flex-col gap-2 rounded-lg border p-4">
              <div className="flex items-center gap-2 font-medium">
                <Icon className="h-4 w-4 text-primary" />
                {label}
              </div>
              <p className="text-xs text-muted-foreground">{hint}</p>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={url}
                  onFocus={(event) => event.target.select()}
                  className="flex-1 font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleCopy(url, `Webhook do ${label}`)}
                >
                  <Copy className="h-4 w-4" />
                  Copiar
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
