/**
 * DeepSeekProvider: integração com a API da DeepSeek
 * (compatível com o formato OpenAI Chat Completions).
 *
 * Configuração: Configurações → Integrações (ou DEEPSEEK_API_KEY no .env)
 * Docs: https://api-docs.deepseek.com
 */
import type { AICompleteOptions, AIResult, AIProvider } from "./provider"

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
const DEEPSEEK_MODEL = "deepseek-chat"

export class DeepSeekProvider implements AIProvider {
  readonly name = "deepseek"

  constructor(private readonly apiKey: string) {}

  async complete(
    systemPrompt: string,
    userPrompt: string,
    options: AICompleteOptions = {}
  ): Promise<AIResult> {
    if (!this.apiKey) {
      return { ok: false, error: "Chave da DeepSeek não configurada" }
    }

    try {
      const response = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: options.temperature ?? 0.4,
          max_tokens: options.maxTokens ?? 1000,
        }),
      })

      if (!response.ok) {
        const body = await response.text()
        if (response.status === 401 || response.status === 403) {
          return {
            ok: false,
            error:
              "A chave da IA é inválida. Confira em Configurações → Integrações e use o botão Testar chave.",
          }
        }
        if (response.status === 429) {
          return {
            ok: false,
            error:
              "A IA está temporariamente sem créditos ou atingiu o limite. Verifique o saldo na DeepSeek.",
          }
        }
        return {
          ok: false,
          error: `DeepSeek respondeu ${response.status}: ${body}`,
        }
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }

      const content = data.choices?.[0]?.message?.content
      if (!content) {
        return { ok: false, error: "DeepSeek não retornou conteúdo" }
      }

      return { ok: true, content }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Falha ao chamar DeepSeek",
      }
    }
  }
}
