cd /opt/clinica-medica
docker exec -i clinica-medica node <<'NODEEOF'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
prisma.clinicSettings.findUnique({ where: { id: 1 } }).then((s) => {
  console.log("deepseekKey:", s?.deepseekApiKey ? `configured (${s.deepseekApiKey.slice(0,6)}...)` : "NOT configured");
  console.log("wapi:", s?.wApiInstance ? "configured" : "NOT configured");
  process.exit(0);
}).catch((e) => { console.error(e.message); process.exit(1); });
NODEEOF
exit
