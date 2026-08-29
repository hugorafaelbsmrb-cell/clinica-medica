"use server"

/**
 * Consulta de CEP via ViaCEP (gratuita, sem chave de API).
 * Usada no cadastro público e no pagamento com cartão para validar o
 * CEP antes de enviar ao Asaas — CEP inexistente derruba a transação.
 */

export type CepAddress = {
  street: string
  neighborhood: string
  city: string
  uf: string
}

export type BuscarCepResult = {
  success: boolean
  address?: CepAddress
  message?: string
}

export async function buscarCep(cep: string): Promise<BuscarCepResult> {
  const digits = cep.replace(/\D/g, "")
  if (!/^\d{8}$/.test(digits)) {
    return { success: false, message: "Digite um CEP com 8 números" }
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      signal: controller.signal,
      // CEP não muda: cacheia por 24h para não abusar do serviço gratuito.
      next: { revalidate: 86400 },
    })
    clearTimeout(timer)

    if (!response.ok) {
      return {
        success: false,
        message: "Não foi possível consultar o CEP agora — tente de novo.",
      }
    }

    const data = (await response.json()) as {
      erro?: boolean
      logradouro?: string
      bairro?: string
      localidade?: string
      uf?: string
    }

    if (data.erro || !data.logradouro || !data.localidade || !data.uf) {
      return {
        success: false,
        message: "CEP não encontrado — confira o número digitado.",
      }
    }

    return {
      success: true,
      address: {
        street: data.logradouro,
        neighborhood: data.bairro || "",
        city: data.localidade,
        uf: data.uf.toUpperCase(),
      },
    }
  } catch {
    return {
      success: false,
      message: "Não foi possível consultar o CEP agora — tente de novo.",
    }
  }
}
