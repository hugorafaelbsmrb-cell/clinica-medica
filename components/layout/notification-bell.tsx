"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, BellRing, CheckCheck } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type NotificationItem = {
  id: string
  type: "NOVA_CONSULTA" | "CONSULTA_CONFIRMADA" | "ATENDENTE"
  title: string
  body: string | null
  link: string | null
  read: boolean
  createdAt: string
}

const POLL_MS = 60_000

function timeLabel(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR })
}

/** Converte a chave VAPID (base64url) para Uint8Array do pushManager. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const base64url = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = window.atob(base64url)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

type PushStatus = "unsupported" | "denied" | "idle" | "active"

/**
 * Sino de notificações do topo do painel: contagem de não lidas +
 * lista das últimas 20. Atualiza por polling (60s) e ao focar a aba.
 */
export function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const [pushStatus, setPushStatus] = useState<PushStatus>("unsupported")
  const router = useRouter()

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" })
      if (!res.ok) return
      const data = await res.json()
      setItems(data.items ?? [])
      setUnread(data.unread ?? 0)
    } catch {
      // Sem conexão: mantém o último estado carregado
    }
  }, [])

  useEffect(() => {
    void load()
    const interval = setInterval(load, POLL_MS)
    const onFocus = () => void load()
    window.addEventListener("focus", onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener("focus", onFocus)
    }
  }, [load])

  const postRead = (ids: string[]) => {
    void fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => {})
  }

  const markRead = (ids: string[]) => {
    setItems((prev) =>
      prev.map((item) => (ids.includes(item.id) ? { ...item, read: true } : item))
    )
    setUnread((prev) => Math.max(0, prev - ids.length))
    postRead(ids)
  }

  const markAllRead = () => {
    setItems((prev) => prev.map((item) => ({ ...item, read: true })))
    setUnread(0)
    postRead([])
  }

  const openItem = (item: NotificationItem) => {
    if (!item.read) markRead([item.id])
    setOpen(false)
    if (item.link) router.push(item.link)
  }

  const ensureRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
    try {
      return (
        (await navigator.serviceWorker.getRegistration()) ??
        (await navigator.serviceWorker.register("/sw.js"))
      )
    } catch {
      return null
    }
  }

  const subscribePush = async (): Promise<boolean> => {
    try {
      const configRes = await fetch("/api/push/config", { cache: "no-store" })
      const config = await configRes.json()
      const publicKey = config.publicKey as string | null
      if (!configRes.ok || !publicKey) return false

      const registration = await ensureRegistration()
      if (!registration) return false

      let sub = await registration.pushManager.getSubscription()
      if (!sub) {
        sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        })
      }

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      })
      return res.ok
    } catch {
      return false
    }
  }

  const enablePush = async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return
    try {
      const permission = await Notification.requestPermission()
      if (permission !== "granted") {
        setPushStatus("denied")
        return
      }
      const ok = await subscribePush()
      setPushStatus(ok ? "active" : "idle")
    } catch {
      setPushStatus("idle")
    }
  }

  const disablePush = async () => {
    try {
      const registration = await ensureRegistration()
      const sub = registration
        ? await registration.pushManager.getSubscription()
        : null
      if (sub) {
        await sub.unsubscribe()
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
      }
    } catch {
      // falha não é crítica: o estado local segue consistente
    }
    setPushStatus("idle")
  }

  // Ao montar: se a permissão já foi concedida, reativa a inscrição
  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return
    const refresh = async () => {
      if (Notification.permission === "granted") {
        const ok = await subscribePush()
        setPushStatus(ok ? "active" : "idle")
      } else if (Notification.permission === "denied") {
        setPushStatus("denied")
      } else {
        setPushStatus("idle")
      }
    }
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={
              unread > 0
                ? `Notificações (${unread} não lidas)`
                : "Notificações"
            }
          >
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Button>
        }
      />
      <PopoverContent
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)] p-0"
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notificações</span>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
              onClick={markAllRead}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Marcar lidas
            </Button>
          )}
        </div>

        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            Nenhuma notificação por enquanto.
          </p>
        ) : (
          <ul className="max-h-[55vh] overflow-y-auto py-1">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openItem(item)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-muted",
                    !item.read && "bg-muted/50"
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {!item.read && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    )}
                    {item.title}
                  </span>
                  {item.body && (
                    <span className="text-xs leading-snug text-muted-foreground">
                      {item.body}
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground/80">
                    {timeLabel(item.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Notificações no celular (Web Push) */}
        <div className="border-t px-3 py-2">
          {pushStatus === "unsupported" ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              Seu navegador não suporta notificações push.
            </p>
          ) : pushStatus === "denied" ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              Notificações bloqueadas neste navegador. Libere nas
              configurações do site para recebê-las no celular.
            </p>
          ) : pushStatus === "active" ? (
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <BellRing className="h-3.5 w-3.5 text-primary" />
                Notificações no celular ativadas
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => void disablePush()}
              >
                Desativar
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5"
                onClick={() => void enablePush()}
              >
                <BellRing className="h-3.5 w-3.5" />
                Ativar notificações no celular
              </Button>
              <p className="text-[11px] leading-snug text-muted-foreground">
                No iPhone, instale o app na tela inicial para receber os
                alertas com o app fechado.
              </p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
