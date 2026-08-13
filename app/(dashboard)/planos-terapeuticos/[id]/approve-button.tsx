"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { approvePlan } from "@/lib/actions/planos"

export function ApprovePlanButton({
  planId,
  disabled,
}: {
  planId: string
  disabled?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      const result = await approvePlan(planId)
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
      onClick={handleClick}
      disabled={pending || disabled}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Check className="h-4 w-4" />
      )}
      Aprovar plano
    </Button>
  )
}
