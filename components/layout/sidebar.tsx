"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import {
  LayoutDashboard,
  Users,
  Stethoscope,
  HeartPulse,
  FileText,
  ClipboardList,
  MessageCircle,
  Wallet,
  BarChart3,
  UserCog,
  Settings,
  CalendarDays,
  MapPinned,
  Workflow,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Menu,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { hasPermission, ROLE_LABELS, type Role } from "@/lib/rbac"
import { clearCredentials } from "@/lib/auth-storage"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"

type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  area: string
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, area: "dashboard" },
  {
    href: "/atendimentos-do-dia",
    label: "Atendimentos do dia",
    icon: MapPinned,
    area: "atendimentos-do-dia",
  },
  { href: "/agenda", label: "Agenda", icon: CalendarDays, area: "agenda" },
  { href: "/pacientes", label: "Pacientes", icon: Users, area: "pacientes" },
  { href: "/atendimentos", label: "Atendimentos", icon: Stethoscope, area: "atendimentos" },
  { href: "/acompanhamentos", label: "Acompanhamentos", icon: HeartPulse, area: "acompanhamentos" },
  { href: "/prescricoes", label: "Prescrições", icon: FileText, area: "prescricoes" },
  { href: "/planos-terapeuticos", label: "Planos Terapêuticos", icon: ClipboardList, area: "planos" },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle, area: "whatsapp" },
  { href: "/automacoes", label: "Automações", icon: Workflow, area: "automacoes" },
  { href: "/financeiro", label: "Financeiro", icon: Wallet, area: "financeiro" },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3, area: "relatorios" },
  { href: "/usuarios", label: "Usuários", icon: UserCog, area: "usuarios" },
  { href: "/configuracoes", label: "Configurações", icon: Settings, area: "configuracoes" },
]

export function Sidebar({
  role,
  clinicName,
  logoDataUrl,
}: {
  role: Role
  clinicName?: string | null
  logoDataUrl?: string | null
}) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const items = NAV_ITEMS.filter((item) => hasPermission(role, item.area))

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex",
        collapsed ? "w-14" : "w-60"
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center gap-2 border-b",
          collapsed ? "justify-center px-2" : "px-4"
        )}
      >
        {logoDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoDataUrl}
            alt={`Logo ${clinicName ?? "da clínica"}`}
            className="h-8 w-8 shrink-0 rounded-md bg-background object-contain p-0.5"
          />
        ) : (
          <Stethoscope className="h-5 w-5 shrink-0 text-primary" />
        )}
        {!collapsed && (
          <span className="truncate font-semibold">{clinicName ?? "Médico em Domicílio"}</span>
        )}
      </div>
      <nav className={cn("flex flex-1 flex-col gap-1", collapsed ? "p-2" : "p-3")}>
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                collapsed && "justify-center px-0",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && item.label}
            </Link>
          )
        })}
      </nav>
      <div className="flex flex-col gap-1 border-t p-3">
        {!collapsed && (
          <p className="px-2 pb-1 text-xs text-sidebar-foreground/60">
            Perfil: {ROLE_LABELS[role]}
          </p>
        )}
        <Button
          variant="ghost"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
          className={cn(
            "w-full justify-start gap-3 px-2 text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
            collapsed && "justify-center"
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
          {!collapsed && "Recolher"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            clearCredentials()
            signOut({ callbackUrl: "/login" })
          }}
          title="Sair"
          className={cn(
            "w-full justify-start gap-3 px-2 text-sidebar-foreground/70 hover:bg-destructive/10 hover:text-destructive",
            collapsed && "justify-center"
          )}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && "Sair"}
        </Button>
      </div>
    </aside>
  )
}

/**
 * Menu lateral em drawer para telas pequenas: o trigger (hambúrguer) fica no
 * header e abre a mesma navegação da sidebar desktop dentro de um Sheet.
 */
export function MobileSidebar({
  role,
  clinicName,
  logoDataUrl,
}: {
  role: Role
  clinicName?: string | null
  logoDataUrl?: string | null
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const items = NAV_ITEMS.filter((item) => hasPermission(role, item.area))

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" title="Abrir menu" className="lg:hidden" />
        }
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Abrir menu</span>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="flex w-64 flex-col gap-0 border-r bg-sidebar p-0 text-sidebar-foreground data-[side=left]:w-64"
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          {logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoDataUrl}
              alt={`Logo ${clinicName ?? "da clínica"}`}
              className="h-8 w-8 shrink-0 rounded-md bg-background object-contain p-0.5"
            />
          ) : (
            <Stethoscope className="h-5 w-5 shrink-0 text-primary" />
          )}
          <span className="truncate font-semibold">{clinicName ?? "Médico em Domicílio"}</span>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
          {items.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="flex flex-col gap-1 border-t p-3">
          <p className="px-2 pb-1 text-xs text-sidebar-foreground/60">
            Perfil: {ROLE_LABELS[role]}
          </p>
          <Button
            variant="ghost"
            onClick={() => {
              clearCredentials()
              signOut({ callbackUrl: "/login" })
            }}
            className="w-full justify-start gap-3 px-2 text-sidebar-foreground/70 hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
