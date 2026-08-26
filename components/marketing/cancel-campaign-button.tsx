"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { cancelMarketingCampaign } from "@/lib/actions/marketing"

/** Botão de cancelar campanha (client: chama a action e mostra o toast). */
export function CancelCampaignButton({ campaignId }: { campaignId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleCancel() {
    setLoading(true)
    const result = await cancelMarketingCampaign(campaignId)
    setLoading(false)
    if (result.success) {
      toast.success(result.message)
      router.refresh()
    } else {
      toast.error(result.message)
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className="h-8 text-destructive hover:text-destructive"
      onClick={handleCancel}
      disabled={loading}
    >
      {loading ? "Cancelando..." : "Cancelar"}
    </Button>
  )
}
