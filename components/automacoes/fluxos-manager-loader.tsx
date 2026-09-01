"use client"

import dynamic from "next/dynamic"
import type { FluxoData } from "@/components/automacoes/fluxos-canvas"

/**
 * Carrega o FluxosManager (React Flow) só no cliente: o `ssr: false` não é
 * permitido em Server Components no Next 16, então o dynamic fica aqui.
 */
const FluxosManager = dynamic(
  () =>
    import("@/components/automacoes/fluxos-canvas").then(
      (mod) => mod.FluxosManager
    ),
  { ssr: false }
)

export function FluxosManagerLoader({
  flows,
  mediaConfigured,
}: {
  flows: FluxoData[]
  mediaConfigured: boolean
}) {
  return <FluxosManager flows={flows} mediaConfigured={mediaConfigured} />
}
