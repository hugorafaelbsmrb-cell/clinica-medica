import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { format } from "date-fns"
import { ArrowLeft } from "lucide-react"
import { auth } from "@/lib/auth"
import { requireRole } from "@/lib/rbac"
import { prisma } from "@/lib/prisma"
import { Button } from "@/components/ui/button"
import { EntryForm } from "@/components/financeiro/entrada-form"

export const metadata: Metadata = { title: "Editar lançamento" }

export default async function EditarFinanceiroPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  requireRole(session, ["ADMIN", "FINANCEIRO"])

  const { id } = await params

  const entry = await prisma.financialEntry.findUnique({ where: { id } })
  if (!entry) notFound()

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          render={<Link href="/financeiro" />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Editar lançamento
          </h1>
          <p className="text-muted-foreground">
            {entry.description} — {format(entry.dueDate, "dd/MM/yyyy")}
          </p>
        </div>
      </div>
      <EntryForm
        initial={{
          id: entry.id,
          type: entry.type,
          category: entry.category,
          description: entry.description,
          value: entry.value.toString(),
          dueDate: format(entry.dueDate, "yyyy-MM-dd"),
          paymentMethod: entry.paymentMethod,
        }}
      />
    </div>
  )
}
