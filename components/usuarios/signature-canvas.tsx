"use client"

/**
 * Canvas de assinatura (mouse ou dedo).
 *
 * Desenha em uma resolução interna fixa (1000×300) e exporta PNG com
 * fundo transparente como data URL — mesmo formato que o sistema já
 * usa (signatureImage) nos PDFs e nas telas. Pointer events unificam
 * mouse e toque; touch-action: none impede scroll/zoom no celular.
 */
import { useEffect, useRef } from "react"
import { Eraser } from "lucide-react"
import { Button } from "@/components/ui/button"

const WIDTH = 1000
const HEIGHT = 300

export function SignatureCanvas({
  onChange,
}: {
  onChange: (dataUrl: string | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  // Traço de caneta: preto, arredondado, espessura proporcional à resolução
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    ctx.strokeStyle = "#111827"
    ctx.lineWidth = 5
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
  }, [])

  /** Converte a posição do ponteiro (px da tela) para as coordenadas do canvas. */
  function getPoint(event: PointerEvent) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    }
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault()
    drawing.current = true
    const ctx = canvasRef.current!.getContext("2d")!
    const { x, y } = getPoint(event.nativeEvent)
    ctx.beginPath()
    ctx.moveTo(x, y)
    canvasRef.current!.setPointerCapture(event.pointerId)
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = canvasRef.current!.getContext("2d")!
    const { x, y } = getPoint(event.nativeEvent)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  /** Fim do traço: exporta o PNG atual para o formulário. */
  function end() {
    if (!drawing.current) return
    drawing.current = false
    onChange(canvasRef.current!.toDataURL("image/png"))
  }

  function clear() {
    const ctx = canvasRef.current!.getContext("2d")!
    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    onChange(null)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-lg border bg-white">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="h-36 w-full cursor-crosshair touch-none"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
          aria-label="Área para desenhar a assinatura"
        />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Assine com o mouse ou com o dedo (no celular/tablet).
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={clear}>
          <Eraser className="h-4 w-4" />
          Limpar
        </Button>
      </div>
    </div>
  )
}
