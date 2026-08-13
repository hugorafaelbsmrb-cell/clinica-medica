"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2, UserCheck, UserX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toggleUserActive } from "@/lib/actions/usuarios"

export function ToggleUserActiveButton({
  userId,
  active,
  isSelf,
}: {
  userId: string
  active: boolean
  isSelf: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      const result = await toggleUserActive(userId)
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
      disabled={pending || isSelf}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : active ? (
        <UserX className="h-4 w-4 sm:hidden" />
      ) : (
        <UserCheck className="h-4 w-4 sm:hidden" />
      )}
      <span className="hidden sm:inline">{active ? "Desativar" : "Ativar"}</span>
    </Button>
  )
}
