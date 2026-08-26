import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { getClinicSettings } from "@/lib/clinic"
import { Sidebar } from "@/components/layout/sidebar"
import { UserMenu } from "@/components/layout/user-menu"
import { NotificationBell } from "@/components/layout/notification-bell"
import { BottomNav } from "@/components/layout/bottom-nav"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const clinic = await getClinicSettings()

  return (
    <div className="flex min-h-screen w-full">
      <Sidebar
        role={session.user.role}
        clinicName={clinic.name}
        logoDataUrl={clinic.logoDataUrl}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-2 border-b bg-background px-3 sm:px-4">
          {/* O menu fica na barra inferior no celular e na sidebar no desktop */}
          <div className="flex items-center gap-1">
            <NotificationBell />
            <UserMenu
              name={session.user.name ?? ""}
              email={session.user.email ?? ""}
              role={session.user.role}
            />
          </div>
        </header>
        <main className="min-w-0 flex-1 bg-muted/30 p-4 pb-[calc(5.25rem+env(safe-area-inset-bottom))] md:p-6 md:pb-[calc(5.25rem+env(safe-area-inset-bottom))] lg:pb-6">
          {children}
        </main>
        <BottomNav
          role={session.user.role}
          clinicName={clinic.name}
          logoDataUrl={clinic.logoDataUrl}
        />
      </div>
    </div>
  )
}
