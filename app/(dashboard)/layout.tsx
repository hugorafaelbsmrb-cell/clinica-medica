import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { getClinicSettings } from "@/lib/clinic"
import { Sidebar } from "@/components/layout/sidebar"
import { UserMenu } from "@/components/layout/user-menu"

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
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-end border-b bg-background px-4">
          <UserMenu
            name={session.user.name ?? ""}
            email={session.user.email ?? ""}
            role={session.user.role}
          />
        </header>
        <main className="flex-1 bg-muted/30 p-6">{children}</main>
      </div>
    </div>
  )
}
