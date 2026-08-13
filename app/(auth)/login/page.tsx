import { redirect } from "next/navigation"
import type { Metadata } from "next"
import { auth } from "@/lib/auth"
import { LoginForm } from "./login-form"

export const metadata: Metadata = {
  title: "Entrar",
}

export default async function LoginPage() {
  const session = await auth()
  if (session) redirect("/dashboard")

  return (
    <main className="flex flex-1 items-center justify-center bg-muted/40 p-6">
      <LoginForm />
    </main>
  )
}
