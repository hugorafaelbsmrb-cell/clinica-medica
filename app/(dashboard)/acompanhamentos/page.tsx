import type { Metadata } from "next"
import Link from "next/link"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { HeartPulse } from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export const metadata: Metadata = { title: "Acompanhamentos" }

const COMPLEXITY_LABELS = {
  BAIXA: "Baixa",
  MEDIA: "Média",
  ALTA: "Alta",
} as const

const COMPLEXITY_VARIANTS = {
  BAIXA: "secondary",
  MEDIA: "default",
  ALTA: "destructive",
} as const

const STATUS_LABELS = {
  ATIVO: "Ativo",
  PAUSADO: "Pausado",
  CONCLUIDO: "Concluído",
  CANCELADO: "Cancelado",
} as const

const STATUS_VARIANTS = {
  ATIVO: "default",
  PAUSADO: "secondary",
  CONCLUIDO: "outline",
  CANCELADO: "ghost",
} as const

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value)
}

export default async function AcompanhamentosPage() {
  const session = await auth()
  requireRole(session, ["ADMIN", "MEDICO"])

  const programs = await prisma.followUpProgram.findMany({
    include: { patient: true },
    orderBy: { createdAt: "desc" },
  })

  const activeCount = programs.filter((p) => p.status === "ATIVO").length

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Acompanhamentos
          </h1>
          <p className="text-muted-foreground">
            {activeCount} programa{activeCount === 1 ? "" : "s"} ativo
            {activeCount === 1 ? "" : "s"} de {programs.length}
          </p>
        </div>
        <HeartPulse className="h-8 w-8 text-primary/40" />
      </div>

      {programs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <HeartPulse className="h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium">Nenhum acompanhamento iniciado</p>
            <p className="text-sm text-muted-foreground">
              Abra a página de um paciente e toque em{" "}
              <strong>Iniciar acompanhamento</strong> para definir a
              complexidade e gerar a cobrança.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {programs.map((program) => (
            <Link key={program.id} href={`/acompanhamentos/${program.id}`}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-base font-semibold">
                      {program.patient.name}
                    </p>
                    <Badge variant={STATUS_VARIANTS[program.status]}>
                      {STATUS_LABELS[program.status]}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={COMPLEXITY_VARIANTS[program.complexity]}>
                      Complexidade {COMPLEXITY_LABELS[program.complexity]}
                    </Badge>
                    <Badge variant="outline">
                      {program.billingMode === "INTEGRAL"
                        ? "Cobrança integral"
                        : `Recorrente (${program.cycleDays}d)`}
                    </Badge>
                  </div>

                  {program.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {program.description}
                    </p>
                  )}

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {program.billingMode === "INTEGRAL"
                        ? "Valor total"
                        : "Valor por ciclo"}
                    </span>
                    <span className="font-medium">
                      {formatCurrency(Number(program.baseValue))}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      Próxima cobrança
                    </span>
                    <span>
                      {program.nextDueAt
                        ? format(program.nextDueAt, "dd/MM/yyyy", {
                            locale: ptBR,
                          })
                        : "—"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
