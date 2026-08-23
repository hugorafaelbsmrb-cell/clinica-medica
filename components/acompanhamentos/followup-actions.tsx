"use client"

/**
 * Ações do detalhe do acompanhamento: nova avaliação (voz → texto),
 * status (pausar/reativar/concluir/cancelar), cobrança avulsa e atalhos
 * para nova prescrição / novo plano terapêutico com o paciente já
 * selecionado.
 */
import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ClipboardList,
  FileText,
  Loader2,
  Pause,
  Play,
  CheckCircle2,
  XCircle,
  NotebookPen,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { VoiceTextarea } from "@/components/ui/voice-textarea"
import { CobrarPacienteButton } from "@/components/pacientes/cobrar-paciente-button"
import {
  createFollowUpEvaluation,
  updateFollowUpStatus,
} from "@/lib/actions/acompanhamentos"

export function FollowUpActions({
  followUpId,
  status,
  patientId,
  patientName,
  sugestaoCobranca,
}: {
  followUpId: string
  status: "ATIVO" | "PAUSADO" | "CONCLUIDO" | "CANCELADO"
  patientId: string
  patientName: string
  sugestaoCobranca: number | null
}) {
  const router = useRouter()
  const [evalOpen, setEvalOpen] = useState(false)
  const [notes, setNotes] = useState("")
  const [savingEval, startSaveEval] = useTransition()
  const [busyStatus, setBusyStatus] = useState<string | null>(null)

  function handleSaveEvaluation() {
    if (notes.trim().length < 3) {
      toast.error("Escreva a avaliação antes de salvar")
      return
    }
    startSaveEval(async () => {
      const res = await createFollowUpEvaluation(followUpId, notes)
      if (res.success) {
        toast.success(res.message)
        setNotes("")
        setEvalOpen(false)
        router.refresh()
      } else {
        toast.error(res.message)
      }
    })
  }

  async function handleStatus(nextStatus: string) {
    const labels: Record<string, string> = {
      PAUSADO: "Pausar este acompanhamento?",
      CONCLUIDO: "Concluir este acompanhamento? A recorrência será encerrada.",
      CANCELADO:
        "Cancelar este acompanhamento? As cobranças pendentes serão canceladas.",
    }
    const label = labels[nextStatus] ?? "Alterar o status deste acompanhamento?"
    if (!window.confirm(label)) return

    setBusyStatus(nextStatus)
    const res = await updateFollowUpStatus(
      followUpId,
      nextStatus as "ATIVO" | "PAUSADO" | "CONCLUIDO" | "CANCELADO"
    )
    setBusyStatus(null)
    if (res.success) {
      toast.success(res.message)
      router.refresh()
    } else {
      toast.error(res.message)
    }
  }

  const encerrado = status === "CONCLUIDO" || status === "CANCELADO"

  return (
    <div className="flex flex-wrap gap-2">
      {/* Nova avaliação (evolução clínica com voz) */}
      <Dialog open={evalOpen} onOpenChange={setEvalOpen}>
        <DialogTrigger render={<Button />}>
          <NotebookPen className="h-4 w-4" />
          Nova avaliação
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova avaliação</DialogTitle>
            <DialogDescription>
              Registre a evolução clínica de {patientName} durante o
              acompanhamento. Use o microfone para ditar.
            </DialogDescription>
          </DialogHeader>
          <VoiceTextarea
            value={notes}
            onValueChange={setNotes}
            placeholder="Ex.: paciente evolui bem, sem queixas; mantém a medicação atual..."
            rows={5}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEvalOpen(false)}
              disabled={savingEval}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleSaveEvaluation}
              disabled={savingEval}
            >
              {savingEval ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <NotebookPen className="h-4 w-4" />
              )}
              Salvar avaliação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Novos documentos clínicos com o paciente pré-selecionado */}
      <Button
        variant="outline"
        render={
          <Link href={`/prescricoes/novo?patientId=${patientId}`} />
        }
      >
        <FileText className="h-4 w-4" />
        Nova prescrição
      </Button>
      <Button
        variant="outline"
        render={
          <Link href={`/planos-terapeuticos/novo?patientId=${patientId}`} />
        }
      >
        <ClipboardList className="h-4 w-4" />
        Novo plano terapêutico
      </Button>

      {/* Cobrança avulsa (mesmo fluxo do botão da página do paciente) */}
      <CobrarPacienteButton
        patientId={patientId}
        patientName={patientName}
        sugestaoValor={sugestaoCobranca}
      />

      {/* Status do acompanhamento */}
      {!encerrado && (
        <div className="flex flex-wrap gap-2">
          {status === "ATIVO" ? (
            <Button
              variant="outline"
              onClick={() => handleStatus("PAUSADO")}
              disabled={busyStatus !== null}
            >
              {busyStatus === "PAUSADO" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Pause className="h-4 w-4" />
              )}
              Pausar
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => handleStatus("ATIVO")}
              disabled={busyStatus !== null}
            >
              {busyStatus === "ATIVO" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Reativar
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => handleStatus("CONCLUIDO")}
            disabled={busyStatus !== null}
          >
            {busyStatus === "CONCLUIDO" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Concluir
          </Button>
          <Button
            variant="destructive"
            onClick={() => handleStatus("CANCELADO")}
            disabled={busyStatus !== null}
          >
            {busyStatus === "CANCELADO" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            Cancelar
          </Button>
        </div>
      )}
    </div>
  )
}
