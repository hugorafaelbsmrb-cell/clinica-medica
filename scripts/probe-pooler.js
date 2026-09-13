// Sonda única: confirma se o pooler do Supabase aceita novas conexões.
const { PrismaClient } = require("@prisma/client")

async function main() {
  const p = new PrismaClient()
  try {
    const count = await p.coupon.count()
    console.log("COUPON_COUNT", count)
  } catch (e) {
    console.log("FALHA:", String(e.message).slice(0, 300))
    process.exitCode = 1
  } finally {
    await p.$disconnect()
  }
}

main()
