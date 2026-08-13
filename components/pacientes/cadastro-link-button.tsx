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
    try {
      await navigator.clipboard.writeText(url)
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
