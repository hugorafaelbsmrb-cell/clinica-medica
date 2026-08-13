"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { toast } from "sonner"
import { TableCell, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { toggleFollowUpAction } from "@/lib/actions/whatsapp"

export function FollowUpRow({
  patientId,
  name,
  active,
  intervalDays,
  nextDueAt,
}: {
  patientId: string
  name: string
  active: boolean
  intervalDays: number
  nextDueAt: Date | null
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleToggle() {
    setLoading(true)
    const result = await toggleFollowUpAction(patientId, intervalDays)
    setLoading(false)
    if (result.success) {
      toast.success(result.message)
      router.refresh()
    } else {
      toast.error(result.message)
    }
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{name}</TableCell>
      <TableCell>{intervalDays} dias</TableCell>
      <TableCell>
        {nextDueAt
          ? format(nextDueAt, "dd/MM/yyyy", { locale: ptBR })
          : "—"}
      </TableCell>
      <TableCell>
        <Badge variant={active ? "secondary" : "outline"}>
          {active ? "Ativo" : "Pausado"}
        </Badge>
      </TableCell>
      <TableCell className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleToggle}
          disabled={loading}
        >
          <Switch checked={active} disabled={loading} />
          <span className="ml-2">{active ? "Pausar" : "Ativar"}</span>
        </Button>
      </TableCell>
    </TableRow>
  )
}
