"use client"

import Link from "next/link"
import { signOut } from "next-auth/react"
import { LogOut, PenLine, UserCircle2 } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ROLE_LABELS, type Role } from "@/lib/rbac"
import { clearCredentials } from "@/lib/auth-storage"

export function UserMenu({
  name,
  email,
  role,
}: {
  name: string
  email: string
  role: Role
}) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" className="flex items-center gap-2 px-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
            <span className="hidden text-sm font-medium sm:block">{name}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-sm font-medium">
            <UserCircle2 className="h-4 w-4 text-muted-foreground" />
            {name}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {email}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {ROLE_LABELS[role]}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {role === "MEDICO" && (
          <DropdownMenuItem render={<Link href="/minha-assinatura" />}>
            <PenLine className="h-4 w-4" />
            Minha assinatura
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            clearCredentials()
            signOut({ callbackUrl: "/login" })
          }}
        >
          <LogOut className="h-4 w-4" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
