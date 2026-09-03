"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react"
import {
  Bot,
  DoorOpen,
  Loader2,
  MessageSquareText,
  Plus,
  Power,
  Save,
  Trash2,
  UserPlus,
  Workflow,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Field, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import {
  deleteFlow,
  saveFlow,
  toggleFlowEnabled,
} from "@/lib/actions/flows"
import {
  GATILHO_LABELS,
  type FlowEdge,
  type FlowNode,
  type FlowKind,
  type GatilhoTipo,
} from "@/lib/whatsapp/flow-types"
import { MediaPicker } from "@/components/automacoes/media-picker"
import {
  AcaoNode,
  GatilhoNode,
  MensagemNode,
  PedirNomeNode,
  PortaoNode,
  RamoNode,
  type CanvasNode,
} from "@/components/automacoes/flows/flow-nodes"

import "@xyflow/react/dist/style.css"

export type FluxoData = {
  id: string
  kind: FlowKind
  name: string
  description: string | null
  enabled: boolean
  nodes: FlowNode[]
  edges: FlowEdge[]
}

type CanvasEdge = Edge<{ delayMinutes?: number }>

type Draft = {
  id: string | null
  kind: FlowKind
  name: string
  description: string
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

type Selection = { type: "node" | "edge"; id: string } | null

const nodeTypes = {
  gatilho: GatilhoNode,
  mensagem: MensagemNode,
  ramo: RamoNode,
  acao: AcaoNode,
  pedirNome: PedirNomeNode,
  portao: PortaoNode,
}

const KIND_LABELS: Record<FlowKind, string> = {
  BOT: "Bot de atendimento",
  AUTOMACAO: "Automação",
  JORNADA: "Jornada",
}

const ACAO_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "PEDIR_CPF", label: "Pedir CPF" },
  { value: "CONSULTAR_CONSULTAS", label: "Consultar consultas (CPF)" },
  { value: "AVISAR_EQUIPE", label: "Avisar equipe (atendente)" },
  { value: "HORARIO", label: "Horário de atendimento" },
  { value: "VALORES", label: "Valores" },
  { value: "ENDERECO", label: "Endereço" },
  { value: "CONTATO", label: "Contato" },
]

const GATILHO_OPTIONS = Object.entries(GATILHO_LABELS) as Array<
  [GatilhoTipo, string]
>

/** Rótulo legível de um atraso em minutos (vazio = sem atraso). */
function delayLabel(minutes?: number): string {
  if (!minutes || minutes <= 0) return ""
  if (minutes % 1440 === 0) {
    const days = minutes / 1440
    return `${days} dia${days > 1 ? "s" : ""}`
  }
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes} min`
}

/** Converte minutos para o par valor/unidade do inspetor. */
function splitDelay(minutes: number): { value: number; unit: "minutos" | "horas" | "dias" } {
  if (minutes > 0 && minutes % 1440 === 0) {
    return { value: minutes / 1440, unit: "dias" }
  }
  if (minutes > 0 && minutes % 60 === 0) {
    return { value: minutes / 60, unit: "horas" }
  }
  return { value: minutes, unit: "minutos" }
}

function toCanvasNodes(flowNodes: FlowNode[]): CanvasNode[] {
  return flowNodes.map((node) => ({
    id: node.id,
    type:
      node.kind === "GATILHO"
        ? "gatilho"
        : node.kind === "MENSAGEM"
          ? "mensagem"
          : node.kind === "RAMO"
            ? "ramo"
            : node.kind === "PEDIR_NOME"
              ? "pedirNome"
              : node.kind === "PORTAO"
                ? "portao"
                : "acao",
    position: node.position,
    data: node,
  }))
}

function toCanvasEdges(flowEdges: FlowEdge[]): CanvasEdge[] {
  return flowEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: delayLabel(edge.delayMinutes),
    data: { delayMinutes: edge.delayMinutes },
  }))
}

function toSaveNodes(nodes: CanvasNode[]): FlowNode[] {
  return nodes.map((node) => node.data)
}

function toSaveEdges(edges: CanvasEdge[]): FlowEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.data?.delayMinutes ? { delayMinutes: edge.data.delayMinutes } : {}),
  }))
}

let nodeCounter = 0
function nextNodeId(kind: string): string {
  nodeCounter += 1
  return `${kind}${Date.now().toString(36)}_${nodeCounter}`
}

/** Fluxo em branco para Nova automação/Nova jornada. */
function blankFlow(kind: "AUTOMACAO" | "JORNADA"): Draft {
  const trigger: FlowNode = {
    id: "gatilho",
    kind: "GATILHO",
    gatilho: kind === "JORNADA" ? "inicio_manual" : "cadastro_incompleto",
    config: {},
    position: { x: 40, y: 220 },
  }
  const message: FlowNode = {
    id: "msg1",
    kind: "MENSAGEM",
    content: "",
    mediaUrl: null,
    mediaType: null,
    position: { x: 400, y: 220 },
  }
  return {
    id: null,
    kind,
    name: "",
    description: "",
    nodes: toCanvasNodes([trigger, message]),
    edges: [{ id: "e1", source: "gatilho", target: "msg1", label: "", data: {} }],
  }
}

/** Novo nó solto no canvas (tipo do drag). */
function newCanvasNode(
  kind: "MENSAGEM" | "PEDIR_NOME" | "PORTAO" | "RAMO" | "ACAO",
  x: number,
  y: number
): CanvasNode {
  const id = nextNodeId(kind.toLowerCase())
  const data: FlowNode =
    kind === "MENSAGEM"
      ? { id, kind: "MENSAGEM", content: "", mediaUrl: null, mediaType: null, position: { x, y } }
      : kind === "PEDIR_NOME"
        ? { id, kind: "PEDIR_NOME", content: "", position: { x, y } }
        : kind === "PORTAO"
          ? { id, kind: "PORTAO", content: "", position: { x, y } }
          : kind === "RAMO"
            ? { id, kind: "RAMO", label: "Novo ramo", keywords: [], optionNumber: null, position: { x, y } }
            : { id, kind: "ACAO", acao: "PEDIR_CPF", position: { x, y } }
  return {
    id,
    type:
      kind === "MENSAGEM"
        ? "mensagem"
        : kind === "RAMO"
          ? "ramo"
          : kind === "PEDIR_NOME"
            ? "pedirNome"
            : kind === "PORTAO"
              ? "portao"
              : "acao",
    position: { x, y },
    data,
  }
}

/** Envia o grafo para a action e faz refresh. */
function useSaveFlow(draft: Draft | null) {
  const router = useRouter()
  const [saving, startSaving] = useTransition()

  function handleSave() {
    if (!draft) return
    const form = new FormData()
    if (draft.id) form.set("flowId", draft.id)
    form.set("kind", draft.kind)
    form.set("name", draft.name)
    form.set("description", draft.description)
    form.set("nodes", JSON.stringify(toSaveNodes(draft.nodes)))
    form.set("edges", JSON.stringify(toSaveEdges(draft.edges)))
    startSaving(async () => {
      const result = await saveFlow(null, form)
      if (result.success) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return { saving, handleSave }
}

export function FluxosManager({
  flows,
  mediaConfigured,
}: {
  flows: FluxoData[]
  mediaConfigured: boolean
}) {
  return (
    <ReactFlowProvider>
      <ManagerInner flows={flows} mediaConfigured={mediaConfigured} />
    </ReactFlowProvider>
  )
}

function ManagerInner({
  flows,
  mediaConfigured,
}: {
  flows: FluxoData[]
  mediaConfigured: boolean
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [selected, setSelected] = useState<Selection>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busy, startBusy] = useTransition()
  const { saving, handleSave } = useSaveFlow(draft)

  const groups = useMemo(() => {
    const order: FlowKind[] = ["BOT", "AUTOMACAO", "JORNADA"]
    return order.map((kind) => ({
      kind,
      flows: flows.filter((f) => f.kind === kind),
    }))
  }, [flows])

  function openFlow(flow: FluxoData) {
    setDraft({
      id: flow.id,
      kind: flow.kind,
      name: flow.name,
      description: flow.description ?? "",
      nodes: toCanvasNodes(flow.nodes),
      edges: toCanvasEdges(flow.edges),
    })
    setSelected(null)
  }

  function openBlank(kind: "AUTOMACAO" | "JORNADA") {
    setDraft(blankFlow(kind))
    setSelected(null)
  }

  function handleToggle(flow: FluxoData) {
    setBusyId(flow.id)
    startBusy(async () => {
      const result = await toggleFlowEnabled(flow.id)
      toast[result.success ? "success" : "error"](result.message)
      setBusyId(null)
    })
  }

  function handleDelete(flow: FluxoData) {
    if (!window.confirm(`Excluir o fluxo "${flow.name}"?`)) return
    setBusyId(flow.id)
    startBusy(async () => {
      const result = await deleteFlow(flow.id)
      toast[result.success ? "success" : "error"](result.message)
      setBusyId(null)
      if (result.success && draft?.id === flow.id) setDraft(null)
    })
  }

  return (
    <div className="flex min-h-[560px] flex-col gap-4 lg:flex-row">
      {/* ===== Sidebar ===== */}
      <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-72">
        <div className="flex flex-col gap-2">
          <Button size="sm" onClick={() => openBlank("AUTOMACAO")}>
            <Plus className="h-4 w-4" /> Nova automação
          </Button>
          <Button size="sm" variant="outline" onClick={() => openBlank("JORNADA")}>
            <Plus className="h-4 w-4" /> Nova jornada
          </Button>
        </div>

        {groups.map((group) => (
          <div key={group.kind} className="flex flex-col gap-1.5">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.kind === "BOT" ? (
                <Bot className="h-3.5 w-3.5" />
              ) : group.kind === "AUTOMACAO" ? (
                <Workflow className="h-3.5 w-3.5" />
              ) : (
                <MessageSquareText className="h-3.5 w-3.5" />
              )}
              {KIND_LABELS[group.kind]}s
            </p>
            {group.flows.map((flow) => (
              <div
                key={flow.id}
                className={`flex flex-col gap-1.5 rounded-lg border p-2.5 ${
                  draft?.id === flow.id ? "border-primary bg-primary/5" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => openFlow(flow)}
                  className="flex items-start justify-between gap-2 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {flow.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {flow.nodes.length}{" "}
                      {flow.nodes.length === 1 ? "nó" : "nós"}
                    </span>
                  </span>
                  <Badge variant={flow.enabled ? "secondary" : "outline"}>
                    {flow.enabled ? "Ativa" : "Inativa"}
                  </Badge>
                </button>
                {flow.kind !== "BOT" && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={busyId === flow.id}
                      onClick={() => handleToggle(flow)}
                    >
                      <Power className="h-3.5 w-3.5" />
                      {flow.enabled ? "Desativar" : "Ativar"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-destructive"
                      disabled={busyId === flow.id}
                      onClick={() => handleDelete(flow)}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Excluir
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {group.flows.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {group.kind === "JORNADA"
                  ? "Nenhuma jornada ainda."
                  : group.kind === "BOT"
                    ? "Fluxo do bot ainda não criado no banco (o seed cria)."
                    : "Nenhuma automação ainda."}
              </p>
            )}
          </div>
        ))}
        {busy && busyId && (
          <p className="text-xs text-muted-foreground">Atualizando...</p>
        )}
      </aside>

      {/* ===== Canvas + inspetor ===== */}
      {draft ? (
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field className="min-w-52 flex-1">
              <FieldLabel>Nome do fluxo *</FieldLabel>
              <Input
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                placeholder="Ex.: Lembrete de retorno"
              />
            </Field>
            <Field className="min-w-40 flex-1">
              <FieldLabel>Descrição (opcional)</FieldLabel>
              <Input
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                placeholder="Para a equipe identificar"
              />
            </Field>
            <Badge variant="outline" className="mb-2">
              {KIND_LABELS[draft.kind]}
            </Badge>
            <Button
              className="mb-0.5"
              disabled={saving || draft.name.trim().length < 3}
              onClick={handleSave}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? "Salvando..." : "Salvar fluxo"}
            </Button>
          </div>

          <div className="flex min-h-[420px] flex-1 gap-3">
            <CanvasArea
              draft={draft}
              setSelected={setSelected}
              onDraftChange={setDraft}
              mediaConfigured={mediaConfigured}
            />
            <Inspector
              draft={draft}
              selected={selected}
              onDraftChange={setDraft}
              mediaConfigured={mediaConfigured}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-10 text-center">
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Selecione um fluxo na lista (ou crie uma automação/jornada) para
              ver o diagrama de nós no estilo n8n.
            </p>
            <p className="text-xs text-muted-foreground">
              Dica: arraste MENSAGEM/RAMO/ACAO da paleta para o canvas e conecte
              pelos pontos laterais.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/** Área do React Flow com a paleta de arrastar. */
function CanvasArea({
  draft,
  setSelected,
  onDraftChange,
  mediaConfigured,
}: {
  draft: Draft
  setSelected: (selection: Selection) => void
  onDraftChange: (draft: Draft) => void
  mediaConfigured: boolean
}) {
  const { screenToFlowPosition } = useReactFlow()

  // Canvas controlado pelo rascunho: qualquer mudança (arrastar, excluir
  // pelo teclado ou pelo inspetor) é aplicada no draft e volta renderizada.
  function commit(next: Draft) {
    onDraftChange(next)
  }

  function handleNodesChange(changes: NodeChange<CanvasNode>[]) {
    const next = applyNodeChanges(changes, draft.nodes)
    commit({ ...draft, nodes: next })
  }

  function handleEdgesChange(changes: EdgeChange<CanvasEdge>[]) {
    const next = applyEdgeChanges(changes, draft.edges)
    commit({ ...draft, edges: next })
  }

  function handleConnect(connection: Connection) {
    const next = addEdge({ ...connection, label: "", data: {} }, draft.edges)
    commit({ ...draft, edges: next })
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault()
    const kind = event.dataTransfer.getData("application/fluxo-nodo") as
      | "MENSAGEM"
      | "PEDIR_NOME"
      | "PORTAO"
      | "RAMO"
      | "ACAO"
      | ""
    if (!kind) return
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const created = newCanvasNode(kind, position.x, position.y)
    commit({ ...draft, nodes: [...draft.nodes, created] })
    setSelected({ type: "node", id: created.id })
  }

  return (
    <div
      className="min-w-0 flex-1 overflow-hidden rounded-lg border bg-muted/30"
      onDrop={handleDrop}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
      }}
    >
      <ReactFlow
        nodes={draft.nodes}
        edges={draft.edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        deleteKeyCode="Backspace"
        onNodeClick={(_, node) => setSelected({ type: "node", id: node.id })}
        onEdgeClick={(_, edge) => setSelected({ type: "edge", id: edge.id })}
        onPaneClick={() => setSelected(null)}
        fitView
        minZoom={0.3}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls />
        <MiniMap pannable zoomable />
        <Panel position="top-left">
          <div className="flex flex-col gap-1.5 rounded-lg border bg-background p-2 shadow-sm">
            <p className="text-xs font-medium text-muted-foreground">
              Arrastar para o canvas:
            </p>
            {(["MENSAGEM", "PEDIR_NOME", "PORTAO", "RAMO", "ACAO"] as const).map(
              (kind) => {
                const disabled = kind !== "MENSAGEM" && draft.kind !== "BOT"
                return (
                  <div
                    key={kind}
                    draggable={!disabled}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("application/fluxo-nodo", kind)
                      event.dataTransfer.effectAllowed = "move"
                    }}
                    className={`flex cursor-grab items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                      disabled
                        ? "cursor-not-allowed opacity-40"
                        : "hover:bg-muted"
                    }`}
                    title={
                      disabled
                        ? "Este nó só existe no fluxo do bot"
                        : "Arraste para o canvas"
                    }
                  >
                    {kind === "MENSAGEM" ? (
                      <MessageSquareText className="h-3.5 w-3.5 text-emerald-600" />
                    ) : kind === "PEDIR_NOME" ? (
                      <UserPlus className="h-3.5 w-3.5 text-fuchsia-600" />
                    ) : kind === "PORTAO" ? (
                      <DoorOpen className="h-3.5 w-3.5 text-teal-600" />
                    ) : kind === "RAMO" ? (
                      <Plus className="h-3.5 w-3.5 text-amber-600" />
                    ) : (
                      <Workflow className="h-3.5 w-3.5 text-violet-600" />
                    )}
                    {kind === "MENSAGEM"
                      ? "Mensagem"
                      : kind === "PEDIR_NOME"
                        ? "Pedir nome"
                        : kind === "PORTAO"
                          ? "Portão"
                          : kind === "RAMO"
                            ? "Ramo"
                            : "Ação"}
                  </div>
                )
              }
            )}
            {!mediaConfigured && (
              <p className="max-w-40 text-[10px] text-muted-foreground">
                Mídias desativadas: configure a API de mídias em Configurações →
                Integrações.
              </p>
            )}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  )
}

/** Painel lateral de edição do nó/aresta selecionado. */
function Inspector({
  draft,
  selected,
  onDraftChange,
  mediaConfigured,
}: {
  draft: Draft
  selected: Selection
  onDraftChange: (draft: Draft) => void
  mediaConfigured: boolean
}) {
  if (!selected) {
    return (
      <aside className="hidden w-72 shrink-0 flex-col gap-2 rounded-lg border p-3 md:flex">
        <p className="text-sm font-medium">Inspetor</p>
        <p className="text-xs text-muted-foreground">
          Clique em um nó ou numa aresta do diagrama para editar. Arraste a
          paleta para adicionar mensagens, ramos e ações.
        </p>
      </aside>
    )
  }

  const node = draft.nodes.find((n) => n.id === selected.id)
  const edge = draft.edges.find((e) => e.id === selected.id)

  // Estreita o union por kind fora dos callbacks — o TS perde o narrowing
  // de `node.data` dentro de closures.
  const messageNode =
    node && node.data.kind === "MENSAGEM"
      ? { id: node.id, data: node.data }
      : null
  const ramoNode =
    node && node.data.kind === "RAMO" ? { id: node.id, data: node.data } : null
  const gatilhoNode =
    node && node.data.kind === "GATILHO"
      ? { id: node.id, data: node.data }
      : null
  const acaoNode =
    node && node.data.kind === "ACAO" ? { id: node.id, data: node.data } : null
  const pedirNomeNode =
    node && node.data.kind === "PEDIR_NOME"
      ? { id: node.id, data: node.data }
      : null
  const portaoNode =
    node && node.data.kind === "PORTAO"
      ? { id: node.id, data: node.data }
      : null

  function updateNodeData(id: string, patch: Partial<FlowNode>) {
    onDraftChange({
      ...draft,
      nodes: draft.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } as FlowNode } : n
      ),
    })
  }

  function removeNode(id: string) {
    onDraftChange({
      ...draft,
      nodes: draft.nodes.filter((n) => n.id !== id),
      edges: draft.edges.filter((e) => e.source !== id && e.target !== id),
    })
  }

  function removeEdge(id: string) {
    onDraftChange({
      ...draft,
      edges: draft.edges.filter((e) => e.id !== id),
    })
  }

  function updateEdgeDelay(id: string, minutes: number) {
    onDraftChange({
      ...draft,
      edges: draft.edges.map((e) =>
        e.id === id
          ? { ...e, data: { ...e.data, delayMinutes: minutes }, label: delayLabel(minutes) }
          : e
      ),
    })
  }

  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border p-3 md:w-80">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {node ? "Nó selecionado" : "Aresta selecionada"}
        </p>
        {node && node.data.kind !== "GATILHO" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-destructive"
            onClick={() => removeNode(node.id)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Excluir
          </Button>
        )}
        {edge && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-destructive"
            onClick={() => removeEdge(edge.id)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Excluir
          </Button>
        )}
      </div>

      {/* ===== MENSAGEM ===== */}
      {messageNode && (
        <>
          <Field>
            <FieldLabel>Texto da mensagem</FieldLabel>
            <Textarea
              value={messageNode.data.content}
              onChange={(event) =>
                updateNodeData(messageNode.id, { content: event.target.value })
              }
              placeholder="Escreva a mensagem enviada ao paciente..."
              className="min-h-24"
            />
          </Field>
          <Field>
            <FieldLabel>Mídia (opcional)</FieldLabel>
            <select
              value={messageNode.data.mediaType ?? ""}
              onChange={(event) => {
                const mediaType = event.target.value as "" | "IMAGEM" | "VIDEO"
                updateNodeData(messageNode.id, {
                  mediaType: mediaType || null,
                  mediaUrl: mediaType ? messageNode.data.mediaUrl : null,
                })
              }}
              className="h-9 rounded-md border bg-background px-3 text-sm"
              disabled={!mediaConfigured}
            >
              <option value="">Sem mídia (só texto)</option>
              <option value="IMAGEM">Imagem</option>
              <option value="VIDEO">Vídeo</option>
            </select>
          </Field>
          {messageNode.data.mediaType && (
            <div className="flex flex-col gap-2">
              {messageNode.data.mediaUrl && (
                <div className="flex items-center gap-2">
                  {messageNode.data.mediaType === "IMAGEM" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={messageNode.data.mediaUrl}
                      alt="Mídia selecionada"
                      className="h-12 w-12 rounded-md border object-cover"
                    />
                  ) : (
                    <span className="flex h-12 w-12 items-center justify-center rounded-md border bg-muted text-xs">
                      MP4
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive"
                    onClick={() =>
                      updateNodeData(messageNode.id, {
                        mediaUrl: null,
                        mediaType: null,
                      })
                    }
                  >
                    Remover mídia
                  </Button>
                </div>
              )}
              {!messageNode.data.mediaUrl && (
                <MediaPicker
                  kind={messageNode.data.mediaType}
                  onSelect={(file) =>
                    updateNodeData(messageNode.id, { mediaUrl: file.url })
                  }
                />
              )}
            </div>
          )}
          {draft.kind === "BOT" && (
            <div className="flex items-center justify-between gap-2 rounded-md border p-2.5">
              <p className="text-xs">
                Anexar opções numeradas dos ramos filhos (menu)
              </p>
              <Switch
                checked={messageNode.data.showOptions === true}
                onCheckedChange={(checked) =>
                  updateNodeData(messageNode.id, { showOptions: checked })
                }
                aria-label="Anexar opções numeradas"
              />
            </div>
          )}
        </>
      )}

      {/* ===== RAMO ===== */}
      {ramoNode && (
        <>
          <Field>
            <FieldLabel>Legenda do ramo</FieldLabel>
            <Input
              value={ramoNode.data.label}
              onChange={(event) =>
                updateNodeData(ramoNode.id, { label: event.target.value })
              }
              placeholder="Ex.: Agendar consulta"
            />
          </Field>
          <Field>
            <FieldLabel>Opção numerada (menu)</FieldLabel>
            <select
              value={ramoNode.data.optionNumber ?? ""}
              onChange={(event) =>
                updateNodeData(ramoNode.id, {
                  optionNumber: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Sem número (só palavra-chave)</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <option key={n} value={n}>
                  Opção {n}
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel>Palavras-chave (separadas por vírgula)</FieldLabel>
            <Input
              value={ramoNode.data.keywords.join(", ")}
              onChange={(event) =>
                updateNodeData(ramoNode.id, {
                  keywords: event.target.value
                    .split(",")
                    .map((k) => k.trim().toLowerCase())
                    .filter(Boolean),
                })
              }
              placeholder="ex.: agendar, marcar consulta"
            />
            <p className="text-xs text-muted-foreground">
              Vazio = ramo &quot;qualquer outra mensagem&quot; (fallback — deve
              ser o último do menu). A ordem das arestas define a prioridade.
            </p>
          </Field>
        </>
      )}

      {/* ===== GATILHO ===== */}
      {gatilhoNode && (
        <>
          <Field>
            <FieldLabel>Gatilho</FieldLabel>
            <select
              value={gatilhoNode.data.gatilho}
              onChange={(event) =>
                updateNodeData(gatilhoNode.id, {
                  gatilho: event.target.value as GatilhoTipo,
                })
              }
              className="h-9 rounded-md border bg-background px-3 text-sm"
              disabled={draft.kind === "BOT" || draft.kind === "JORNADA"}
            >
              {GATILHO_OPTIONS.filter(
                ([value]) =>
                  value !== "mensagem_recebida" && value !== "inicio_manual"
              ).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {gatilhoNode.data.gatilho === "tratamento_periodico" && (
            <ConfigNumberField
              label="Intervalo entre mensagens (dias)"
              value={numberOr(gatilhoNode.data.config?.intervalDays, 7)}
              onChange={(value) =>
                updateNodeData(gatilhoNode.id, {
                  config: { ...gatilhoNode.data.config, intervalDays: value },
                })
              }
            />
          )}
          {gatilhoNode.data.gatilho === "reativacao" && (
            <ConfigNumberField
              label="Dias sem consulta para reativar"
              value={numberOr(gatilhoNode.data.config?.days, 60)}
              onChange={(value) =>
                updateNodeData(gatilhoNode.id, {
                  config: { ...gatilhoNode.data.config, days: value },
                })
              }
            />
          )}
          {gatilhoNode.data.gatilho === "lembrete_pagamento" && (
            <ConfigNumberField
              label="Espera antes do lembrete (minutos)"
              value={numberOr(gatilhoNode.data.config?.delayMinutes, 60)}
              onChange={(value) =>
                updateNodeData(gatilhoNode.id, {
                  config: { ...gatilhoNode.data.config, delayMinutes: value },
                })
              }
            />
          )}
        </>
      )}

      {/* ===== ACAO ===== */}
      {acaoNode && (
        <>
          <Field>
            <FieldLabel>Ação</FieldLabel>
            <select
              value={acaoNode.data.acao}
              onChange={(event) =>
                updateNodeData(acaoNode.id, {
                  acao: event.target.value as typeof acaoNode.data.acao,
                })
              }
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              {ACAO_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          {acaoNode.data.acao === "PEDIR_CPF" && (
            <Field>
              <FieldLabel>Frase do pedido de CPF (opcional)</FieldLabel>
              <Textarea
                value={acaoNode.data.intro ?? ""}
                onChange={(event) =>
                  updateNodeData(acaoNode.id, { intro: event.target.value })
                }
                placeholder="Ex.: Para remarcar uma consulta, me envie o seu CPF."
                className="min-h-16"
              />
            </Field>
          )}
        </>
      )}

      {/* ===== PEDIR_NOME ===== */}
      {pedirNomeNode && (
        <>
          <Field>
            <FieldLabel>Boas-vindas que pede o nome</FieldLabel>
            <Textarea
              value={pedirNomeNode.data.content}
              onChange={(event) =>
                updateNodeData(pedirNomeNode.id, { content: event.target.value })
              }
              placeholder="Ex.: Olá! 👋 Seja bem-vindo(a) à {{clinica}}!"
              className="min-h-24"
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            Enviado para quem ainda não é paciente e não informou o nome.
            Variáveis: {"{{clinica}}"}.
          </p>
        </>
      )}

      {/* ===== PORTAO ===== */}
      {portaoNode && (
        <>
          <Field>
            <FieldLabel>Pergunta do portão</FieldLabel>
            <Textarea
              value={portaoNode.data.content}
              onChange={(event) =>
                updateNodeData(portaoNode.id, { content: event.target.value })
              }
              placeholder="Ex.: Obrigado, {{nome}}! Você já é paciente?"
              className="min-h-24"
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            Os ramos filhos com opção numerada viram botões de resposta rápida.
            Variáveis: {"{{nome}}"}.
          </p>
        </>
      )}

      {/* ===== ARESTA ===== */}
      {edge && (
        <>
          {draft.kind === "BOT" ? (
            <p className="text-xs text-muted-foreground">
              No fluxo do bot, a condição do desvio fica no nó RAMO — as
              arestas não têm atraso.
            </p>
          ) : (
            <DelayField
              minutes={edge.data?.delayMinutes ?? 0}
              onChange={(minutes) => updateEdgeDelay(edge.id, minutes)}
            />
          )}
        </>
      )}
    </aside>
  )
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function ConfigNumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        className="w-28"
      />
    </Field>
  )
}

function DelayField({
  minutes,
  onChange,
}: {
  minutes: number
  onChange: (minutes: number) => void
}) {
  const split = splitDelay(minutes)
  return (
    <Field>
      <FieldLabel>Enviar depois de</FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          max={split.unit === "dias" ? 30 : split.unit === "horas" ? 720 : 43200}
          value={split.value}
          onChange={(event) => {
            const value = Math.max(0, Number(event.target.value) || 0)
            const multiplier =
              split.unit === "dias" ? 1440 : split.unit === "horas" ? 60 : 1
            onChange(value * multiplier)
          }}
          className="w-24"
        />
        <select
          value={split.unit}
          onChange={(event) => {
            const unit = event.target.value as "minutos" | "horas" | "dias"
            const multiplier = unit === "dias" ? 1440 : unit === "horas" ? 60 : 1
            const value = minutes / (unit === "dias" ? 1440 : unit === "horas" ? 60 : 1)
            onChange(Math.round(value) * multiplier)
          }}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="minutos">minutos</option>
          <option value="horas">horas</option>
          <option value="dias">dias</option>
        </select>
      </div>
      <p className="text-xs text-muted-foreground">
        Tempo até a próxima mensagem (0 = enviar junto/imediato). Máximo: 30
        dias por aresta.
      </p>
    </Field>
  )
}
