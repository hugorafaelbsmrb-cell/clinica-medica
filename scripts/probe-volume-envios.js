/**
 * Sonda: volume e origem dos envios (anti-banimento). Conta Message OUT por
 * tipo nas últimas 48h, campanhas ativas, tamanhos de público e configs.
 */
const fs = require("fs")
const path = require("path")

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8")
const match = env.match(/^DATABASE_URL=["']?([^"'\r\n]+)/m)
if (!match) throw new Error("DATABASE_URL não encontrada no .env")
let url = match[1].replace(":5432", ":6543")
if (!url.includes("pgbouncer=true")) {
  url += (url.includes("?") ? "&" : "?") + "pgbouncer=true"
}
process.env.DATABASE_URL = url

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const now = Date.now()

  for (const horas of [24, 48, 168]) {
    const since = new Date(now - horas * 3600_000)
    const rows = await prisma.message.groupBy({
      by: ["type", "direction"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    })
    console.log(`\n=== Message criadas nas ultimas ${horas}h ===`)
    for (const r of rows.sort((a, b) => b._count._all - a._count._all)) {
      console.log(`- ${r.direction} ${r.type}: ${r._count._all}`)
    }
  }

  const pendentes = await prisma.message.count({
    where: { status: "PENDENTE", direction: "OUT" },
  })
  console.log(`\n=== Fila atual: ${pendentes} mensagens PENDENTE (OUT) ===`)

  const emFila = await prisma.message.findMany({
    where: { status: "PENDENTE", direction: "OUT" },
    orderBy: { scheduledFor: "asc" },
    take: 5,
    select: { type: true, scheduledFor: true, content: true },
  })
  for (const m of emFila) {
    console.log(
      `- ${m.type} | scheduled=${m.scheduledFor?.toISOString() ?? "-"} | ${String(m.content).slice(0, 60)}`
    )
  }

  const campanhas = await prisma.marketingCampaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      name: true,
      status: true,
      scheduledFor: true,
      createdAt: true,
      audience: true,
      sentCount: true,
      failedCount: true,
    },
  })
  console.log(`\n=== Campanhas de marketing (ultimas 10) ===`)
  for (const c of campanhas) {
    const aud = c.audience ?? {}
    console.log(
      `- [${c.status}] "${c.name}" | publico=${aud.kind} total=${aud.total ?? "?"} | enviados=${c.sentCount} falhas=${c.failedCount} | agendada=${c.scheduledFor?.toISOString().slice(0, 16) ?? "-"}`
    )
  }

  const leads = await prisma.whatsAppContact.count({ where: { converted: false } })
  const leadsTotal = await prisma.whatsAppContact.count()
  const pacientesWpp = await prisma.patient.count({
    where: { whatsappEnabled: true, phone: { not: null }, lgpdConsent: true },
  })
  console.log(`\n=== Publicos ===`)
  console.log(`- WhatsAppContact (leads): ${leads} nao convertidos de ${leadsTotal}`)
  console.log(`- Patients contactaveis (wpp+lgpd): ${pacientesWpp}`)

  const stages = await prisma.whatsAppContact.groupBy({
    by: ["followUpStage"],
    where: { converted: false },
    _count: { _all: true },
  })
  console.log(`\n=== Follow-up stages (leads) ===`)
  for (const s of stages) console.log(`- stage ${s.followUpStage}: ${s._count._all}`)

  const cfg = await prisma.clinicSettings.findUnique({
    where: { id: 1 },
    select: {
      botEnabled: true,
      botPauseHours: true,
      autoCadastroEnabled: true,
      autoWhatsappFollowUpEnabled: true,
      autoTratamentoEnabled: true,
      autoTratamentoIntervalDays: true,
      autoAniversarioEnabled: true,
      autoReativacaoEnabled: true,
      autoReativacaoDays: true,
      autoAgradecimentoEnabled: true,
      autoACaminhoEnabled: true,
    },
  })
  console.log(`\n=== Configuracoes atuais ===`)
  console.log(JSON.stringify(cfg, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
