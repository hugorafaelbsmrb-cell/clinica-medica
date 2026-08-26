/**
 * Geração de mensagens de campanha de marketing com IA.
 * Escreve a mensagem do WhatsApp no tom escolhido, respeitando o
 * marketing médico ético (sem promessa de cura, sem sensacionalismo)
 * e a personalização por {{nome}} já usada pelo envio.
 */
import { getAIProvider, type AIResult } from "./provider"

export type MarketingMessageInput = {
  tone: string
  topic: string
  linkUrl?: string | null
  currentMessage?: string | null
}

/** Descrição de cada tom enviada à IA junto com o tema. */
const TONE_INSTRUCTIONS: Record<string, string> = {
  informativo:
    "Informativo: comunicar uma novidade ou orientação útil com clareza, sem pressão de compra.",
  promocional:
    "Promocional: divulgar um serviço, programa ou condição especial de forma convidativa, dentro da ética médica.",
  sazonal:
    "Sazonal: aproveitar uma data, estação ou campanha de saúde do momento (ex.: vacinação, início do ano) para engajar.",
  evento:
    "Evento: convidar para um evento, palestra ou mutirão da clínica.",
}

const SYSTEM_PROMPT = `Você é redator de mensagens de WhatsApp para uma clínica médica.
Regras obrigatórias:
- Mensagem curta e direta, adequada ao WhatsApp (no máximo 600 caracteres).
- Comece sempre com "Olá {{nome}}!" — use exatamente o placeholder {{nome}} para o primeiro nome do paciente; nunca o substitua por outro texto.
- Siga o tom indicado no pedido.
- Marketing médico ético: não prometa cura nem resultado de tratamento, não crie urgência artificial, sem termos sensacionalistas, sem CAPS LOCK.
- Use no máximo 2 emojis, discretos.
- Se houver link, inclua-o de forma natural ao final, em linha própria.
- Termine com uma chamada à ação simples (ex.: "É só responder por aqui.").
- Responda APENAS a mensagem final: sem comentários, sem aspas, sem título.`

export async function generateMarketingMessage(
  input: MarketingMessageInput
): Promise<AIResult> {
  const provider = await getAIProvider()
  if (!provider) {
    return { ok: false, error: "Nenhum provedor de IA configurado" }
  }

  const toneInstruction =
    TONE_INSTRUCTIONS[input.tone] ?? TONE_INSTRUCTIONS.informativo

  const userPrompt = `Tom da mensagem: ${toneInstruction}
Tema/assunto: ${input.topic}
${input.linkUrl ? `Link a incluir: ${input.linkUrl}` : "Link: nenhum."}
${
  input.currentMessage
    ? `Texto atual para servir de base (reescreva mantendo a intenção):\n${input.currentMessage}`
    : ""
}

Escreva a mensagem da campanha.`

  // Mais criativo que o resumo clínico; resposta curta de WhatsApp.
  return provider.complete(SYSTEM_PROMPT, userPrompt, {
    temperature: 0.8,
    maxTokens: 400,
  })
}
