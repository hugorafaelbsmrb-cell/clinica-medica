"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

/** Copia o link personalizado de cadastro do lead para a área de transferência. */
export function CopyLeadLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      // Fallback para navegadores sem clipboard API
      const textarea = document.createElement("textarea")
      textarea.value = link
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand("copy")
      document.body.removeChild(textarea)
    }
    setCopied(true)
    toast.success("Link de cadastro copiado!")
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      <span className="ml-2">{copied ? "Copiado" : "Link"}</span>
    </Button>
  )
}
