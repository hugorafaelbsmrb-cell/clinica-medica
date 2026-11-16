/**
 * Faixa de aviso global: o número da clínica está desconectado da W-API.
 *
 * Sem isso a queda passava em silêncio — os envios eram aceitos pela W-API
 * (HTTP 200 + messageId) mesmo sem conexão e o painel não mostrava nada.
 * O estado vem de ClinicSettings, alimentado pelo cron check-connection e
 * pelos eventos de conexão do webhook.
 */
import Link from "next/link"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { TriangleAlert } from "lucide-react"

export function WhatsAppConnectionBanner({
  disconnectedAt,
  checkedAt,
}: {
  /** Quando a queda foi detectada (null = verificações ainda sem histórico). */
  disconnectedAt: Date | null
  /** Última verificação do estado (para não parecer aviso travado). */
  checkedAt: Date | null
}) {
  const since = disconnectedAt
    ? format(disconnectedAt, "dd/MM 'às' HH:mm", { locale: ptBR })
    : null
  const checked = checkedAt
    ? format(checkedAt, "dd/MM 'às' HH:mm", { locale: ptBR })
    : null

  return (
    <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 sm:px-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-destructive">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        <span className="font-medium">
          WhatsApp desconectado{since ? ` desde ${since}` : ""}:
        </span>
        <span className="text-destructive/90">
          os envios automáticos estão pausados e a fila fica guardada.
        </span>
        <Link
          href="/configuracoes"
          className="font-semibold underline underline-offset-2 hover:opacity-80"
        >
          Reconectar o número
        </Link>
        {checked ? (
          <span className="text-xs text-destructive/70">
            (verificado {checked})
          </span>
        ) : null}
      </div>
    </div>
  )
}
