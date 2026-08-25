/**
 * Web Push: envia notificações nativas para os celulares inscritos.
 * Usa o serviço do navegador (Android Chrome direto; no iPhone, o app
 * precisa estar instalado na tela inicial — iOS 16.4+). As chaves VAPID
 * identificam a clínica junto aos serviços de push dos navegadores.
 */
import webpush from "web-push"
import { prisma } from "@/lib/prisma"

export type PushPayload = {
  title: string
  body?: string
  url: string
  notificationId?: string
}

function isConfigured(): boolean {
  return Boolean(process.env.VAPID_PRIVATE_KEY && process.env.VAPID_PUBLIC_KEY)
}

/**
 * Envia o payload para todas as inscrições ativas da clínica.
 * Inscrições revogadas pelo navegador (404/410) são removidas.
 * Nunca lança erro: notificação push é um extra, não pode quebrar
 * os fluxos de agendamento/pagamento.
 */
export async function dispatchPush(payload: PushPayload): Promise<void> {
  if (!isConfigured()) return

  webpush.setVapidDetails(
    "mailto:contato@medicoemdomicilio.com",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  )

  const subs = await prisma.pushSubscription.findMany()
  if (subs.length === 0) return

  const body = JSON.stringify(payload)

  await Promise.all(
    subs.map(async (sub) => {
      try {
        const keys = JSON.parse(sub.keysJson) as { p256dh: string; auth: string }
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys },
          body,
          { TTL: 3600 }
        )
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          // Inscrição não existe mais no navegador: limpa do banco
          await prisma.pushSubscription
            .delete({ where: { id: sub.id } })
            .catch(() => {})
        } else {
          console.error(`[Push] Falha ao enviar (${sub.id.slice(0, 8)}):`, error)
        }
      }
    })
  )
}
