docker compose -f /opt/clinica-medica/docker-compose.yml exec -T app node -e '
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const s = await prisma.clinicSettings.findUnique({ where: { id: 1 } });
  console.log("instance:", s.wApiInstance);
  console.log("token set:", !!s.wApiToken);
  console.log("botEnabled:", s.botEnabled);
  console.log("boasvindas set:", !!s.botMsgBoasVindas, "| agendar set:", !!s.botMsgAgendar);

  // Consulta o webhook configurado na W-API
  if (s.wApiInstance && s.wApiToken) {
    const url = "https://api.w-api.app/v1/webhook?instanceId=" + encodeURIComponent(s.wApiInstance);
    const res = await fetch(url, { headers: { Authorization: "Bearer " + s.wApiToken } });
    console.log("GET /webhook ->", res.status, "|", await res.text());
  }
  process.exit(0);
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
'
