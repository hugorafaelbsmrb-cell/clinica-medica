"use client"

import { Link2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

/**
 * Copia o link público de pré-cadastro para a área de transferência,
 * para a equipe enviar ao paciente no primeiro contato.
 */
export function CadastroLinkButton() {
  async function copyLink() {
    const url = `${window.location.origin}/cadastro`

    // Fallback para HTTP (fora de contexto seguro o clipboard API não existe).
    async function legacyCopy(): Promise<void> {
      const textarea = document.createElement("textarea")
      textarea.value = url
      textarea.style.position = "fixed"
      textarea.style.opacity = "0"
      document.body.appendChild(textarea)
      textarea.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(textarea)
      if (!ok) throw new Error("copy failed")
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      } else {
        await legacyCopy()
      }
      toast.success("Link de cadastro copiado! Envie ao paciente.")
    } catch {
      toast.error("Não foi possível copiar o link")
    }
  }

  return (
    <Button variant="outline" onClick={copyLink}>
      <Link2 className="h-4 w-4" />
      Copiar link de cadastro
    </Button>
  )
}
