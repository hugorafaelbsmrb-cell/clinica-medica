"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ClipboardList,
  MapPinned,
  Menu,
  Stethoscope,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { hasPermission, type Role } from "@/lib/rbac"
import { Sheet, SheetTrigger } from "@/components/ui/sheet"
import { MobileSidebarContent } from "@/components/layout/sidebar"

type BottomNavItem = {
  href: string
  label: string
  icon: LucideIcon
  area: string
  featured?: boolean
}

const NAV_ITEMS: BottomNavItem[] = [
  {
    href: "/atendimentos-do-dia",
    label: "Atendimento do dia",
    icon: MapPinned,
    area: "atendimentos-do-dia",
    featured: true,
  },
  {
    href: "/atendimentos",
    label: "Atendimentos",
    icon: Stethoscope,
    area: "atendimentos",
  },
  {
    href: "/planos-terapeuticos",
    label: "Planos Terapêuticos",
    icon: ClipboardList,
    area: "planos",
  },
]

/**
 * Barra inferior flutuante para o PWA/celular (estilo Nubank): cartão
 * arredondado descolado das bordas e acima da área do gesto do iPhone
 * (some em telas lg+). Atalho destacado para "Atendimento do dia", os
 * demais acessos rápidos e o sanduíche que abre o menu lateral. Respeita
 * as permissões do perfil logado.
 */
export function BottomNav({
  role,
  clinicName,
  logoDataUrl,
}: {
  role: Role
  clinicName?: string | null
  logoDataUrl?: string | null
}) {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const items = NAV_ITEMS.filter((item) => hasPermission(role, item.area))

  return (
    <nav className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 rounded-2xl border bg-background/95 shadow-lg shadow-black/10 backdrop-blur lg:hidden">
      <div className="flex h-16 items-stretch justify-around px-1">
        {items.map(({ href, label, icon: Icon, featured }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)

          if (featured) {
            return (
              <Link
                key={href}
                href={href}
                title={label}
                className="flex min-w-16 flex-col items-center justify-center gap-1"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform active:scale-95">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="max-w-20 text-center text-[10px] font-semibold leading-tight text-primary">
                  {label}
                </span>
              </Link>
            )
          }

          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={cn(
                "flex min-w-16 flex-col items-center justify-center gap-0.5 text-muted-foreground transition-colors",
                active && "text-primary"
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="max-w-20 text-center text-[10px] font-medium leading-tight">
                {label}
              </span>
            </Link>
          )
        })}

        {/* Sanduíche: abre o menu lateral com toda a navegação */}
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger
            render={
              <button
                type="button"
                title="Abrir menu"
                className="flex min-w-16 flex-col items-center justify-center gap-0.5 text-muted-foreground transition-colors"
              />
            }
          >
            <Menu className="h-5 w-5" />
            <span className="text-[10px] font-medium">Menu</span>
          </SheetTrigger>
          <MobileSidebarContent
            role={role}
            clinicName={clinicName}
            logoDataUrl={logoDataUrl}
            onNavigate={() => setMenuOpen(false)}
          />
        </Sheet>
      </div>
    </nav>
  )
}
