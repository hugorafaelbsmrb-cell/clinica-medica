/**
 * Aplica o schema de cupons (Coupon/CouponUse/DiscountType/couponId) no banco
 * do Supabase através do pooler transaction mode (:6543), usado enquanto o
 * pooler session mode (:5432) estiver com as conexões esgotadas.
 *
 * Uso (com o DATABASE_URL apontando para :6543?pgbouncer=true):
 *   node scripts/apply-coupons-schema.js
 *
 * Idempotente: instruções já existentes (42P07/42701) são ignoradas.
 */
const { PrismaClient } = require("@prisma/client")

const STATEMENTS = [
  `CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED')`,

  `CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discountType" "DiscountType" NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL,
    "minValue" DECIMAL(10,2),
    "maxDiscount" DECIMAL(10,2),
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE "CouponUse" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "attendanceId" TEXT,
    "originalValue" DECIMAL(10,2) NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CouponUse_pkey" PRIMARY KEY ("id")
  )`,

  `ALTER TABLE "MarketingCampaign" ADD COLUMN "couponId" TEXT`,

  `CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code")`,
  `CREATE INDEX "Coupon_enabled_idx" ON "Coupon"("enabled")`,
  `CREATE INDEX "CouponUse_patientId_idx" ON "CouponUse"("patientId")`,
  `CREATE UNIQUE INDEX "CouponUse_couponId_patientId_key" ON "CouponUse"("couponId", "patientId")`,

  `ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "CouponUse" ADD CONSTRAINT "CouponUse_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "CouponUse" ADD CONSTRAINT "CouponUse_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "CouponUse" ADD CONSTRAINT "CouponUse_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
]

async function main() {
  const p = new PrismaClient()
  let failures = 0
  for (const sql of STATEMENTS) {
    const preview = sql.replace(/\s+/g, " ").slice(0, 70)
    try {
      await p.$executeRawUnsafe(sql)
      console.log("OK   :", preview)
    } catch (e) {
      const code = e?.meta?.code ?? ""
      if (code === "42P07" || code === "42701") {
        console.log("EXISTE:", preview)
        continue
      }
      console.log("ERRO :", preview, "->", String(e?.message ?? e).slice(0, 200))
      failures++
    }
  }
  await p.$disconnect()
  console.log(failures === 0 ? "TUDO APLICADO" : `FALHAS: ${failures}`)
  process.exitCode = failures === 0 ? 0 : 1
}

main()
