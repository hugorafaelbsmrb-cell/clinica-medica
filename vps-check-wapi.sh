cd /opt/clinica-medica
echo "--- env file ---"
grep -E "W_API|NEXT_PUBLIC_APP_URL" .env | sed 's/\(TOKEN=.\{6\}\).*/\1.../; s/\(INSTANCE=.\{6\}\).*/\1.../'
echo "--- db ---"
docker compose exec -T app node -e 'const {PrismaClient}=require("@prisma/client");const p=new PrismaClient();(async()=>{const s=await p.clinicSettings.findUnique({where:{id:1},select:{wApiInstance:true,wApiToken:true}});console.log(JSON.stringify({instanciaNoBanco:!!s?.wApiInstance,tokenNoBanco:!!s?.wApiToken}));await p.$disconnect()})()'
