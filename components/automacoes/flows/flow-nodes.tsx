"use client"

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import {
  GitBranch,
  MessageSquareText,
  PlayCircle,
  Workflow,
  Zap,
} from "lucide-react"
import { GATILHO_LABELS, type FlowNode } from "@/lib/whatsapp/flow-types"

/** Nó do canvas: o FlowNode inteiro viaja no campo `data`. */
export type CanvasNode = Node<FlowNode, "gatilho" | "mensagem" | "ramo" | "acao">

const ACAO_LABELS: Record<string, string> = {
  PEDIR_CPF: "Pedir CPF",
  CONSULTAR_CONSULTAS: "Consultar consultas",
  AVISAR_EQUIPE: "Avisar equipe",
  HORARIO: "Horário de atendimento",
  VALORES: "Valores",
  ENDERECO: "Endereço",
  CONTATO: "Contato",
}

function NodeShell({
  selected,
  children,
  className,
}: {
  selected?: boolean
  children: React.ReactNode
  className: string
}) {
  return (
    <div
      className={`${className} w-56 rounded-lg border p-2.5 text-xs shadow-sm ${
        selected ? "ring-2 ring-primary ring-offset-1" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} />
      {children}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function nodeData(props: NodeProps): FlowNode {
  return props.data as FlowNode
}

/** GATILHO: pill colorido com ícone e nome do gatilho. */
export function GatilhoNode(props: NodeProps) {
  const node = nodeData(props)
  if (node.kind !== "GATILHO") return null
  const config = node.config ?? {}
  const extras = Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ")
  return (
    <NodeShell
      selected={props.selected}
      className="border-sky-400/50 bg-sky-500/10 text-sky-700 dark:text-sky-300"
    >
      <div className="flex items-center gap-2 font-medium">
        <Zap className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{GATILHO_LABELS[node.gatilho] ?? node.gatilho}</span>
      </div>
      {extras && <p className="mt-1 truncate text-muted-foreground">{extras}</p>}
    </NodeShell>
  )
}

/** MENSAGEM: bolha estilo WhatsApp com preview do texto e miniatura. */
export function MensagemNode(props: NodeProps) {
  const node = nodeData(props)
  if (node.kind !== "MENSAGEM") return null
  return (
    <NodeShell
      selected={props.selected}
      className="border-emerald-400/50 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
    >
      <div className="flex items-start gap-2">
        {node.mediaUrl ? (
          node.mediaType === "VIDEO" ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted">
              <PlayCircle className="h-5 w-5 text-muted-foreground" />
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={node.mediaUrl}
              alt="Mídia da mensagem"
              className="h-10 w-10 shrink-0 rounded-md border object-cover"
            />
          )
        ) : (
          <MessageSquareText className="h-4 w-4 shrink-0 text-emerald-600" />
        )}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-3 whitespace-pre-wrap break-words text-muted-foreground">
            {node.content || <em>sem texto</em>}
          </p>
          {node.showOptions && (
            <span className="mt-1 inline-block rounded bg-emerald-600/15 px-1.5 py-0.5 text-[10px] font-medium">
              menu com opções
            </span>
          )}
        </div>
      </div>
    </NodeShell>
  )
}

/** RAMO: condição de desvio (palavras-chave ou opção numerada). */
export function RamoNode(props: NodeProps) {
  const node = nodeData(props)
  if (node.kind !== "RAMO") return null
  const isFallback = node.keywords.length === 0 && node.optionNumber == null
  return (
    <NodeShell
      selected={props.selected}
      className="border-amber-400/50 bg-amber-500/10 text-amber-900 dark:text-amber-200"
    >
      <div className="flex items-center gap-2 font-medium">
        <GitBranch className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{node.label || "Ramo"}</span>
        {typeof node.optionNumber === "number" && (
          <span className="rounded bg-amber-600/15 px-1.5 py-0.5 text-[10px] font-semibold">
            opção {node.optionNumber}
          </span>
        )}
        {isFallback && (
          <span className="rounded bg-amber-600/15 px-1.5 py-0.5 text-[10px]">
            qualquer outra
          </span>
        )}
      </div>
      {node.keywords.length > 0 && (
        <p className="mt-1 truncate text-muted-foreground">
          {node.keywords.slice(0, 4).join(", ")}
          {node.keywords.length > 4 ? "…" : ""}
        </p>
      )}
    </NodeShell>
  )
}

/** ACAO: retângulo com ícone da ação. */
export function AcaoNode(props: NodeProps) {
  const node = nodeData(props)
  if (node.kind !== "ACAO") return null
  return (
    <NodeShell
      selected={props.selected}
      className="border-violet-400/50 bg-violet-500/10 text-violet-800 dark:text-violet-300"
    >
      <div className="flex items-center gap-2 font-medium">
        <Workflow className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{ACAO_LABELS[node.acao] ?? node.acao}</span>
      </div>
      {node.intro && (
        <p className="mt-1 line-clamp-2 text-muted-foreground">{node.intro}</p>
      )}
    </NodeShell>
  )
}
