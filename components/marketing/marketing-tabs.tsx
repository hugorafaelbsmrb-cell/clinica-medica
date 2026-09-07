"use client"

import type { ReactNode } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

/**
 * Abas da página de Marketing — campanhas e cupons ficam em abas próprias
 * para encurtar a rolagem. Os painéis ficam montados (keepMounted) para não
 * perder o rascunho da campanha ao alternar entre as abas.
 */
export function MarketingTabs({
  campanhas,
  cupons,
}: {
  campanhas: ReactNode
  cupons: ReactNode
}) {
  return (
    <Tabs defaultValue="campanhas">
      <TabsList className="max-w-full overflow-x-auto">
        <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
        <TabsTrigger value="cupons">Cupons</TabsTrigger>
      </TabsList>

      <TabsContent value="campanhas" className="pt-4" keepMounted>
        {campanhas}
      </TabsContent>
      <TabsContent value="cupons" className="pt-4" keepMounted>
        {cupons}
      </TabsContent>
    </Tabs>
  )
}
