/**
 * Geração do resumo do plano terapêutico com IA.
 * Reúne diagnóstico, objetivos, orientações e prescrições e pede
 * um resumo objetivo, em linguagem acessível ao paciente.
 */
import { getAIProvider, type AIResult } from "./provider"

export type PlanInput = {
  patientName: string
  diagnosis: string
  goals?: string | null
  guidelines?: string | null
  prescriptions: string[]
}

const SYSTEM_PROMPT = `Você é um assistente médico que escreve resumos de planos terapêuticos para pacientes.
Regras:
- Use linguagem simples e acessível, sem jargões técnicos.
- O resumo deve ter no máximo 250 palavras.
- Estruture em: 1) Entendendo sua condição, 2) Tratamento recomendado, 3) Orientações do dia a dia.
- NÃO invente informações que não estejam nos dados fornecidos.
- NÃO dê conselhos que substituam a orientação do médico.`

export async function generatePlanSummary(
  input: PlanInput
): Promise<AIResult> {
  const provider = await getAIProvider()
  if (!provider) {
    return { ok: false, error: "Nenhum provedor de IA configurado" }
  }

  const userPrompt = `Paciente: ${input.patientName}
Diagnóstico: ${input.diagnosis}
${input.goals ? `Objetivos do tratamento: ${input.goals}` : ""}
${input.guidelines ? `Orientações do médico: ${input.guidelines}` : ""}
${
  input.prescriptions.length > 0
    ? `Medicamentos prescritos:\n${input.prescriptions
        .map((p) => `- ${p}`)
        .join("\n")}`
    : "Medicamentos: nenhum."
}

Escreva o resumo do plano terapêutico deste paciente.`

  return provider.complete(SYSTEM_PROMPT, userPrompt)
}
