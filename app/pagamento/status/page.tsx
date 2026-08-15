import type { Metadata } from "next"
import Link from "next/link"
import { CheckCircle2, XCircle } from "lucide-react"

export const metadata: Metadata = { title: "Status do pagamento" }

/**
 * Página pública para onde os gateways redirecionam o paciente depois do
 * checkout. A baixa automática acontece pelo webhook — esta página é apenas
 * o feedback visual de sucesso/cancelamento.
 */
export default async function PagamentoStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string }>
}) {
  const { r } = await searchParams
  const ok = r === "ok"

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      {ok ? (
        <CheckCircle2 className="h-14 w-14 text-emerald-600" />
      ) : (
        <XCircle className="h-14 w-14 text-muted-foreground" />
      )}
      <h1 className="text-2xl font-semibold tracking-tight">
        {ok ? "Pagamento confirmado!" : "Pagamento não concluído"}
      </h1>
      <p className="max-w-md text-muted-foreground">
        {ok
          ? "Recebemos a confirmação do pagamento. O lançamento já foi baixado automaticamente no sistema. Obrigado!"
          : "Se você desistiu por engano, peça um novo link de pagamento para a clínica. Nenhum valor foi cobrado."}
      </p>
      <p className="text-xs text-muted-foreground">
        {ok
          ? "Você já pode fechar esta página."
          : "Se precisar, fale com a clínica pelo WhatsApp."}
      </p>
      <Link
        href="/"
        className="mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Voltar ao início
      </Link>
    </main>
  )
}
