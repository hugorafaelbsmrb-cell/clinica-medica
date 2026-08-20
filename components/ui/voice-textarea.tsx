"use client"

/**
 * Textarea com botão de microfone para ditado por voz.
 *
 * Usa a Web Speech API (SpeechRecognition) do navegador, em pt-BR:
 * funciona no Chrome/Edge (desktop e Android). O botão só aparece em
 * navegadores compatíveis — nos demais, o campo continua normal.
 *
 * A voz é transcrita no próprio navegador; nada de áudio é enviado
 * para os servidores. O texto ditado é anexado ao conteúdo do campo.
 */
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Mic } from "lucide-react"
import { cn } from "@/lib/utils"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"

/** Tipagem mínima da API de reconhecimento (não existe no lib.dom). */
type SpeechRecognitionResult = {
  isFinal: boolean
  0: { transcript: string }
}

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { results: ArrayLike<SpeechRecognitionResult> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

function getRecognitionCtor():
  | (new () => SpeechRecognitionLike)
  | undefined {
  if (typeof window === "undefined") return undefined
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export type VoiceTextareaProps = {
  name?: string
  required?: boolean
  minLength?: number
  placeholder?: string
  rows?: number
  className?: string
  /** Modo controlado (ex.: resumo preenchido pela IA). */
  value?: string
  onValueChange?: (value: string) => void
  /** Modo não controlado (valor inicial do formulário). */
  defaultValue?: string
}

export function VoiceTextarea({
  name,
  required,
  minLength,
  placeholder,
  rows,
  className,
  value,
  onValueChange,
  defaultValue,
}: VoiceTextareaProps) {
  const [text, setText] = useState(value ?? defaultValue ?? "")
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  // Mantém o modo controlado sincronizado quando o valor vem de fora
  // (ex.: resumo gerado pela IA substituindo o texto atual).
  useEffect(() => {
    if (value !== undefined) setText(value)
  }, [value])

  // Detecta o suporte só depois da hidratação: no servidor e no primeiro
  // render do cliente o valor é false, evitando erro de hidratação do React.
  const [supported, setSupported] = useState(false)
  useEffect(() => {
    setSupported(Boolean(getRecognitionCtor()))
  }, [])

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(event.target.value)
    onValueChange?.(event.target.value)
  }

  function handleToggleMic() {
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }

    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      toast.error("Seu navegador não suporta ditado por voz")
      return
    }

    const recognition = new Ctor()
    recognition.lang = "pt-BR"
    recognition.continuous = false
    recognition.interimResults = false

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .filter((result) => result.isFinal)
        .map((result) => result[0].transcript)
        .join(" ")
        .trim()
      if (!transcript) return
      setText((current) => {
        const merged = current.trim() ? `${current.trim()} ${transcript}` : transcript
        onValueChange?.(merged)
        return merged
      })
    }

    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast.error("Microfone bloqueado — libere a permissão no navegador")
      } else if (event.error === "no-speech") {
        toast.error("Não ouvi nada — fale mais perto do microfone")
      } else if (event.error !== "aborted") {
        toast.error("Falha no reconhecimento de voz — tente novamente")
      }
    }

    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition

    try {
      recognition.start()
      setListening(true)
      toast.info("Ouvindo... fale agora")
    } catch {
      setListening(false)
      toast.error("Não foi possível iniciar o microfone")
    }
  }

  return (
    <div className="relative">
      <Textarea
        name={name}
        required={required}
        minLength={minLength}
        value={text}
        onChange={handleChange}
        placeholder={placeholder}
        rows={rows}
        className={cn(className, "pr-10")}
      />
      {supported && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleToggleMic}
          aria-label={listening ? "Parar ditado" : "Ditar por voz"}
          title={listening ? "Parar ditado" : "Ditar por voz"}
          className={cn(
            "absolute right-1.5 bottom-1.5",
            listening && "text-destructive"
          )}
        >
          <Mic className={cn("h-4 w-4", listening && "animate-pulse")} />
        </Button>
      )}
    </div>
  )
}
