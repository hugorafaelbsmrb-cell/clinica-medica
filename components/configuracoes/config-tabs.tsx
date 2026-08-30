"use client"

import type { ReactNode } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

/**
 * Abas da página de Configurações — cada área (clínica, integrações,
 * pagamentos e webhooks) fica em uma aba própria para encurtar a rolagem.
 */
export function ConfigTabs({
  clinica,
  integracoes,
  pagamentos,
  webhooks,
}: {
  clinica: ReactNode
  integracoes: ReactNode
  pagamentos: ReactNode
  webhooks: ReactNode
}) {
  return (
    <Tabs defaultValue="clinica">
      <TabsList className="max-w-full overflow-x-auto">
        <TabsTrigger value="clinica">Clínica</TabsTrigger>
        <TabsTrigger value="integracoes">Integrações (API)</TabsTrigger>
        <TabsTrigger value="pagamentos">Pagamentos</TabsTrigger>
        <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
      </TabsList>

      <TabsContent value="clinica" className="pt-4">
        {clinica}
      </TabsContent>
      <TabsContent value="integracoes" className="pt-4">
        {integracoes}
      </TabsContent>
      <TabsContent value="pagamentos" className="pt-4">
        {pagamentos}
      </TabsContent>
      <TabsContent value="webhooks" className="pt-4">
        {webhooks}
      </TabsContent>
    </Tabs>
  )
}
