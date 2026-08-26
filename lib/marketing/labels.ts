/**
 * Rótulos compartilhados das campanhas de marketing.
 * Módulo sem imports de servidor: usado pelo formulário (client)
 * e pela lista (server).
 */
export const TONE_LABELS: Record<string, string> = {
  informativo: "Informativo",
  promocional: "Promocional",
  sazonal: "Sazonal",
  evento: "Evento",
}

export const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  RASCUNHO: "Rascunho",
  AGENDADA: "Agendada",
  ENVIANDO: "Enviando",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
}
