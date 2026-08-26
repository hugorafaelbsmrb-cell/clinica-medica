/**
 * Seed: cria o usuário admin inicial e dados de exemplo.
 * Executar com: npm run db:seed
 */
import { PrismaClient, EntryCategory, EntryType } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

async function main() {
  console.log("Iniciando seed...")

  // Usuários padrão
  const adminPassword = await bcrypt.hash("admin123", 10)

  const admin = await prisma.user.upsert({
    where: { email: "admin@clinica.com" },
    update: {},
    create: {
      name: "Administrador",
      email: "admin@clinica.com",
      password: adminPassword,
      role: "ADMIN",
    },
  })
  console.log(`Usuário criado: ${admin.email} / senha: admin123`)

  const medicoPassword = await bcrypt.hash("medico123", 10)
  const medico = await prisma.user.upsert({
    where: { email: "medico@clinica.com" },
    update: {
      crm: "CRM/SP 123456",
      signatureText: "Dr. Carlos Mendes",
    },
    create: {
      name: "Dr. Carlos Mendes",
      email: "medico@clinica.com",
      password: medicoPassword,
      role: "MEDICO",
      crm: "CRM/SP 123456",
      signatureText: "Dr. Carlos Mendes",
    },
  })
  console.log(`Usuário criado: ${medico.email} / senha: medico123`)

  const secretariaPassword = await bcrypt.hash("secreta123", 10)
  await prisma.user.upsert({
    where: { email: "secretaria@clinica.com" },
    update: {},
    create: {
      name: "Ana Paula",
      email: "secretaria@clinica.com",
      password: secretariaPassword,
      role: "SECRETARIA",
    },
  })
  console.log("Usuário criado: secretaria@clinica.com / senha: secreta123")

  const financeiroPassword = await bcrypt.hash("financeiro123", 10)
  await prisma.user.upsert({
    where: { email: "financeiro@clinica.com" },
    update: {},
    create: {
      name: "Beatriz Souza",
      email: "financeiro@clinica.com",
      password: financeiroPassword,
      role: "FINANCEIRO",
    },
  })
  console.log("Usuário criado: financeiro@clinica.com / senha: financeiro123")

  // Configurações padrão da clínica (registro único)
  const clinic = await prisma.clinicSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: "Médico em Domicílio",
      address: "Rua Exemplo, 123 — Centro, São Paulo/SP — CEP 00000-000",
      phone: "(11) 99999-0000",
      email: "contato@clinica.com",
      cnpj: "00.000.000/0000-00",
    },
  })
  console.log(`Clínica configurada: ${clinic.name}`)

  // Templates de mensagem padrão
  const templates = [
    {
      name: "Primeiro contato",
      type: "PRIMEIRO_CONTATO" as const,
      body: "Olá {{nome}}! Aqui é do Médico em Domicílio. Que bom ter você com a gente. Estamos à disposição para cuidar da sua saúde. Qualquer dúvida, é só responder por aqui.",
    },
    {
      name: "Acompanhamento de saúde",
      type: "ACOMPANHAMENTO" as const,
      body: "Olá {{nome}}, tudo bem? Como você está se sentindo? Passando para saber como anda a sua saúde. Se precisar de algo, é só nos chamar!",
    },
    {
      name: "Confirmação de agendamento",
      type: "CONFIRMACAO_AGENDAMENTO" as const,
      body: "Olá {{nome}}! Sua consulta está confirmada para {{data}} às {{hora}}. Se precisar remarcar, acesse: {{link}}\nSua teleconsulta será por videochamada: {{meet}}",
    },
    {
      name: "Lembrete de consulta",
      type: "LEMBRETE_CONSULTA" as const,
      body: "Olá {{nome}}! Lembrete: sua consulta é hoje, {{data}} às {{hora}}.\nSua teleconsulta será por videochamada: {{meet}}",
    },
  ]

  for (const template of templates) {
    const exists = await prisma.messageTemplate.findFirst({
      where: { name: template.name },
    })
    if (!exists) {
      await prisma.messageTemplate.create({ data: template })
      console.log(`Template criado: ${template.name}`)
    }
  }

  // Pacientes de exemplo
  const samplePatients = [
    {
      name: "João Pereira",
      cpf: "123.456.789-00",
      phone: "5511999990001",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
    },
    {
      name: "Maria Oliveira",
      cpf: "987.654.321-00",
      phone: "5511988880002",
      neighborhood: "Jardim América",
      city: "São Paulo",
      state: "SP",
    },
    {
      name: "Pedro Santos",
      phone: "5511977770003",
      neighborhood: "Vila Mariana",
      city: "São Paulo",
      state: "SP",
    },
  ]

  const existingPatients = await prisma.patient.count()
  if (existingPatients === 0) {
    for (const patient of samplePatients) {
      const created = await prisma.patient.create({
        data: {
          ...patient,
          lgpdConsent: true,
          lgpdConsentAt: new Date(),
          whatsappEnabled: true,
          followUp: {
            create: {
              active: true,
              intervalDays: 30,
              nextDueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
          },
        },
      })
      console.log(`Paciente criado: ${created.name}`)
    }
  }

  // Entrada financeira de exemplo
  const existingEntries = await prisma.financialEntry.count()
  if (existingEntries === 0) {
    await prisma.financialEntry.create({
      data: {
        type: EntryType.RECEITA,
        category: EntryCategory.CONSULTA_PRESENCIAL,
        description: "Consulta de exemplo",
        value: 350,
        dueDate: new Date(),
      },
    })
    console.log("Entrada financeira de exemplo criada")
  }

  console.log("Seed concluído!")
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
