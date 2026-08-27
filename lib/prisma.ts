import { PrismaClient } from "@prisma/client"

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

/**
 * Limita o pool de conexões do Prisma abaixo do pool_size do pooler do
 * Supabase (15 em modo sessão). Sem esse limite, o pool padrão do Prisma
 * (CPUs * 2 + 1) pode crescer além do pooler e travar as consultas com
 * "max clients reached".
 */
function withConnectionLimit(
  url: string | undefined,
  limit = 10
): string | undefined {
  if (!url || url.includes("connection_limit=")) return url
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=${limit}`
}

const databaseUrl = withConnectionLimit(process.env.DATABASE_URL)

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  })

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}
