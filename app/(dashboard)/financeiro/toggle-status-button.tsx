"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Undo2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toggleEntryStatus } from "@/lib/actions/financeiro"

export function ToggleStatusButton({
  entryId,
  isPaid,
}: {
  entryId: string
  isPaid: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      const result = await toggleEntryStatus(entryId)
      if (result.success) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={pending}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isPaid ? (
        <Undo2 className="h-4 w-4" />
      ) : (
        <Check className="h-4 w-4" />
      )}
      {isPaid ? "Reabrir" : "Marcar pago"}
    </Button>
  )
}
