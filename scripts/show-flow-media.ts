/**
 * Mostra o nó MENSAGEM do fluxo "Reserva liberada" (mediaUrl atual).
 * Uso: npx tsx scripts/show-flow-media.ts
 */
import { PrismaClient } from "@prisma/client"
import { parseFlowNodes } from "../lib/whatsapp/flow-types"

const FLOW_ID = "cmti1uphc000cvfrszlq8av50"

type FlowNode = {
  id: string
  kind: string
  content?: string
  mediaUrl?: string | null
  mediaType?: string | null
}

const p = new PrismaClient()

async function main() {
  const flow = await p.messageFlow.findUnique({ where: { id: FLOW_ID } })
  if (!flow) throw new Error("Fluxo não encontrado")
  const nodes = parseFlowNodes(flow.nodes)
  for (const n of nodes) {
    const node = n as FlowNode
    if (node.kind === "MENSAGEM") {
      console.log(`content="${node.content}"`)
      console.log(`mediaUrl=${node.mediaUrl}`)
      console.log(`mediaType=${node.mediaType}`)
    }
  }
}

main()
  .then(() => p.$disconnect())
  .catch((err) => {
    console.error(err)
    p.$disconnect()
    process.exit(1)
  })
