-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MEDICO', 'SECRETARIA', 'FINANCEIRO');

-- CreateEnum
CREATE TYPE "AttendanceType" AS ENUM ('PRESENCIAL', 'DOMICILIAR', 'TELECONSULTA');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('AGUARDANDO_PAGAMENTO', 'AGENDADO', 'EM_ATENDIMENTO', 'REALIZADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "PlanSource" AS ENUM ('MANUAL', 'IA');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('RASCUNHO', 'GERADO', 'APROVADO');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('PRIMEIRO_CONTATO', 'ACOMPANHAMENTO', 'MANUAL', 'RESPOSTA', 'DOCUMENTO', 'CONFIRMACAO_AGENDAMENTO', 'LEMBRETE_CONSULTA', 'CADASTRO_INCOMPLETO', 'TRATAMENTO_PERIODICO', 'ANIVERSARIO', 'REATIVACAO', 'AGRADECIMENTO', 'MEDICO_A_CAMINHO', 'LINK_PAGAMENTO', 'LEMBRETE_PAGAMENTO', 'PAGAMENTO_CONFIRMADO', 'AGENDAMENTO_CANCELADO', 'MARKETING', 'JORNADA');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDENTE', 'ENVIADA', 'ENTREGUE', 'LIDA', 'FALHA', 'SUPRIMIDA');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('RECEITA', 'DESPESA');

-- CreateEnum
CREATE TYPE "EntryCategory" AS ENUM ('CONSULTA_PRESENCIAL', 'CONSULTA_DOMICILIAR', 'TELECONSULTA', 'ACOMPANHAMENTO', 'PROCEDIMENTO', 'MEDICAMENTO', 'OPERACIONAL', 'OUTRO');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('PAGO', 'PENDENTE');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('ASAAS', 'STRIPE', 'MOCK');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PIX', 'CARTAO', 'APPLE_PAY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDENTE', 'PAGO', 'EXPIRADO', 'CANCELADO', 'FALHOU', 'REFUNDED');

-- CreateEnum
CREATE TYPE "FollowUpComplexity" AS ENUM ('BAIXA', 'MEDIA', 'ALTA');

-- CreateEnum
CREATE TYPE "FollowUpBillingMode" AS ENUM ('INTEGRAL', 'RECORRENTE');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('ATIVO', 'PAUSADO', 'CONCLUIDO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NOVA_CONSULTA', 'CONSULTA_CONFIRMADA', 'ATENDENTE');

-- CreateEnum
CREATE TYPE "ExceptionType" AS ENUM ('BLOQUEADO', 'LIVRE');

-- CreateEnum
CREATE TYPE "MarketingCampaignStatus" AS ENUM ('RASCUNHO', 'AGENDADA', 'ENVIANDO', 'CONCLUIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "FlowKind" AS ENUM ('BOT', 'AUTOMACAO', 'JORNADA');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'SECRETARIA',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "crm" TEXT,
    "signatureText" TEXT,
    "signatureImage" TEXT,
    "meetLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL DEFAULT 'M├®dico em Domic├¡lio',
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "cnpj" TEXT,
    "horarioAtendimento" TEXT,
    "logoDataUrl" TEXT,
    "deepseekApiKey" TEXT,
    "wApiInstance" TEXT,
    "wApiToken" TEXT,
    "birdIdBaseUrl" TEXT,
    "birdIdClientId" TEXT,
    "birdIdClientSecretEnc" TEXT,
    "mediaApiKey" TEXT,
    "mediaSlug" TEXT,
    "botEnabled" BOOLEAN NOT NULL DEFAULT true,
    "botMsgAtendente" TEXT,
    "botMsgSaude" TEXT,
    "botMsgCpfNaoEncontrado" TEXT,
    "botMsgBoasVindas" TEXT,
    "botMsgAgendar" TEXT,
    "botPauseHours" INTEGER NOT NULL DEFAULT 24,
    "autoCadastroEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoCadastroDelayHours" INTEGER NOT NULL DEFAULT 24,
    "autoCadastroMsg" TEXT,
    "autoCadastroFollowUp2Msg" TEXT,
    "autoCadastroFollowUp3Msg" TEXT,
    "autoWhatsappFollowUpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoWhatsappFollowUpMsg" TEXT,
    "autoWhatsappFollowUp2Msg" TEXT,
    "autoWhatsappFollowUp3Msg" TEXT,
    "autoTratamentoEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoTratamentoIntervalDays" INTEGER NOT NULL DEFAULT 7,
    "autoTratamentoMsg" TEXT,
    "autoAniversarioEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoAniversarioMsg" TEXT,
    "autoReativacaoEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoReativacaoDays" INTEGER NOT NULL DEFAULT 60,
    "autoReativacaoMsg" TEXT,
    "autoAgradecimentoEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoAgradecimentoMsg" TEXT,
    "autoACaminhoEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoACaminhoMsg" TEXT,
    "asaasApiKey" TEXT,
    "stripeSecretKey" TEXT,
    "stripeWebhookSecret" TEXT,
    "pixEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cartaoEnabled" BOOLEAN NOT NULL DEFAULT true,
    "applePayEnabled" BOOLEAN NOT NULL DEFAULT true,
    "dinheiroEnabled" BOOLEAN NOT NULL DEFAULT true,
    "consultaPrecoPresencial" DECIMAL(10,2),
    "consultaPrecoDomiciliar" DECIMAL(10,2),
    "consultaPrecoDomiciliarFora" DECIMAL(10,2),
    "consultaPrecoTeleconsulta" DECIMAL(10,2),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "raioUrbanoKm" DOUBLE PRECISION,
    "acompValorBaixa" DECIMAL(10,2),
    "acompValorMedia" DECIMAL(10,2),
    "acompValorAlta" DECIMAL(10,2),
    "jurosParcelamento" DECIMAL(5,2) NOT NULL DEFAULT 2.99,
    "autoPagamentoLinkEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoPagamentoLinkMsg" TEXT,
    "autoPagamentoLembreteEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoPagamentoLembreteDelayMinutes" INTEGER NOT NULL DEFAULT 60,
    "autoPagamentoLembreteMsg" TEXT,
    "autoPagamentoConfirmadoEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoPagamentoConfirmadoMsg" TEXT,
    "autoAgendamentoFollowUpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoAgendamentoFollowUpMsg" TEXT,
    "autoAgendamentoCanceladoMsg" TEXT,
    "enableDigitalSignature" BOOLEAN NOT NULL DEFAULT false,
    "consultaPresencialEnabled" BOOLEAN NOT NULL DEFAULT true,
    "consultaDomiciliarEnabled" BOOLEAN NOT NULL DEFAULT true,
    "consultaTeleconsultaEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cpf" TEXT,
    "birthDate" TIMESTAMP(3),
    "phone" TEXT,
    "email" TEXT,
    "street" TEXT,
    "number" TEXT,
    "complement" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "insurance" TEXT,
    "notes" TEXT,
    "consultationReason" TEXT,
    "lgpdConsent" BOOLEAN NOT NULL DEFAULT false,
    "lgpdConsentAt" TIMESTAMP(3),
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
    "registeredVia" TEXT NOT NULL DEFAULT 'MANUAL',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "locationSource" TEXT,
    "locationUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "doctorId" TEXT,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT,
    "type" "AttendanceType" NOT NULL DEFAULT 'PRESENCIAL',
    "status" "AttendanceStatus" NOT NULL DEFAULT 'AGENDADO',
    "origin" TEXT NOT NULL DEFAULT 'INTERNO',
    "slotNote" TEXT,
    "cancelToken" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "homeAddress" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "locationSource" TEXT,
    "distanceKm" DOUBLE PRECISION,
    "pricingZone" TEXT,
    "anamnesis" TEXT,
    "value" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paymentMethod" TEXT,
    "cashReceivedAt" TIMESTAMP(3),
    "cashReceivedBy" TEXT,
    "teleconsentAcceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "attendanceId" TEXT,
    "doctorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionItem" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "medication" TEXT NOT NULL,
    "dosage" TEXT,
    "frequency" TEXT,
    "duration" TEXT,
    "instructions" TEXT,

    CONSTRAINT "PrescriptionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapeuticPlan" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT,
    "diagnosis" TEXT NOT NULL,
    "goals" TEXT,
    "guidelines" TEXT,
    "summary" TEXT,
    "source" "PlanSource" NOT NULL DEFAULT 'MANUAL',
    "status" "PlanStatus" NOT NULL DEFAULT 'RASCUNHO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TherapeuticPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "patientId" TEXT,
    "whatsAppContactId" TEXT,
    "attendanceId" TEXT,
    "type" "MessageType" NOT NULL DEFAULT 'MANUAL',
    "direction" TEXT NOT NULL DEFAULT 'OUT',
    "content" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDENTE',
    "needsAttention" BOOLEAN NOT NULL DEFAULT false,
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "error" TEXT,
    "marketingCampaignId" TEXT,
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "attendanceId" TEXT,
    "patientId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keysJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotSession" (
    "phone" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'MENU',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotSession_pkey" PRIMARY KEY ("phone")
);

-- CreateTable
CREATE TABLE "BotPause" (
    "phone" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'atendimento_humano',
    "resumeAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotPause_pkey" PRIMARY KEY ("phone")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'ACOMPANHAMENTO',
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpConfig" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "intervalDays" INTEGER NOT NULL DEFAULT 30,
    "lastSentAt" TIMESTAMP(3),
    "nextDueAt" TIMESTAMP(3),
    "templateId" TEXT,

    CONSTRAINT "FollowUpConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpProgram" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'ATIVO',
    "complexity" "FollowUpComplexity" NOT NULL,
    "description" TEXT,
    "billingMode" "FollowUpBillingMode" NOT NULL,
    "baseValue" DECIMAL(10,2) NOT NULL,
    "totalValue" DECIMAL(10,2) NOT NULL,
    "installments" INTEGER,
    "installmentValue" DECIMAL(10,2),
    "cycleDays" INTEGER,
    "nextDueAt" TIMESTAMP(3),
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpEvaluation" (
    "id" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "doctorId" TEXT,
    "notes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationAttempt" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT NOT NULL,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "contacted" BOOLEAN NOT NULL DEFAULT false,
    "contactedAt" TIMESTAMP(3),
    "followUpStage" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppContact" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followUpStage" INTEGER NOT NULL DEFAULT 0,
    "contactedAt" TIMESTAMP(3),
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialEntry" (
    "id" TEXT NOT NULL,
    "type" "EntryType" NOT NULL,
    "category" "EntryCategory" NOT NULL DEFAULT 'OUTRO',
    "description" TEXT NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT,
    "status" "EntryStatus" NOT NULL DEFAULT 'PENDENTE',
    "attendanceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDENTE',
    "providerPaymentId" TEXT,
    "checkoutUrl" TEXT,
    "pixCopiaCola" TEXT,
    "pixQrCodeUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "externalStatus" TEXT,
    "fee" DECIMAL(10,2),
    "remindedAt" TIMESTAMP(3),
    "followUpStage" INTEGER NOT NULL DEFAULT 0,
    "financialEntryId" TEXT,
    "attendanceId" TEXT,
    "followUpId" TEXT,
    "installments" INTEGER,
    "installmentValue" DECIMAL(10,2),
    "cycleNumber" INTEGER,
    "patientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "eventId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityRule" (
    "id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "doctorId" TEXT,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "slotDurationMin" INTEGER NOT NULL DEFAULT 60,
    "bufferMin" INTEGER NOT NULL DEFAULT 15,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvailabilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityException" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "ExceptionType" NOT NULL DEFAULT 'BLOQUEADO',
    "startTime" TEXT,
    "endTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "minAdvanceHours" INTEGER NOT NULL DEFAULT 2,
    "maxAdvanceDays" INTEGER NOT NULL DEFAULT 60,
    "cancelLimitHours" INTEGER NOT NULL DEFAULT 12,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "patientId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalCertificate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedPfx" TEXT NOT NULL,
    "encryptedPassword" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "serialNumber" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BirdIdCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "encryptedCertPem" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "serialNumber" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BirdIdCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BirdIdSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BirdIdSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tone" TEXT NOT NULL DEFAULT 'informativo',
    "body" TEXT NOT NULL,
    "imageDataUrl" TEXT,
    "linkUrl" TEXT,
    "couponId" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'RASCUNHO',
    "audience" JSONB,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
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
);

-- CreateTable
CREATE TABLE "CouponUse" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "attendanceId" TEXT,
    "originalValue" DECIMAL(10,2) NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponUse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronRun" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageFlow" (
    "id" TEXT NOT NULL,
    "kind" "FlowKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nodes" JSONB NOT NULL,
    "edges" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageFlow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_cpf_key" ON "Patient"("cpf");

-- CreateIndex
CREATE INDEX "Patient_name_idx" ON "Patient"("name");

-- CreateIndex
CREATE INDEX "Patient_neighborhood_idx" ON "Patient"("neighborhood");

-- CreateIndex
CREATE INDEX "Patient_doctorId_idx" ON "Patient"("doctorId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_cancelToken_key" ON "Attendance"("cancelToken");

-- CreateIndex
CREATE INDEX "Attendance_patientId_idx" ON "Attendance"("patientId");

-- CreateIndex
CREATE INDEX "Attendance_scheduledAt_idx" ON "Attendance"("scheduledAt");

-- CreateIndex
CREATE INDEX "Attendance_status_idx" ON "Attendance"("status");

-- CreateIndex
CREATE INDEX "Prescription_patientId_idx" ON "Prescription"("patientId");

-- CreateIndex
CREATE INDEX "PrescriptionItem_prescriptionId_idx" ON "PrescriptionItem"("prescriptionId");

-- CreateIndex
CREATE INDEX "TherapeuticPlan_patientId_idx" ON "TherapeuticPlan"("patientId");

-- CreateIndex
CREATE INDEX "Message_patientId_idx" ON "Message"("patientId");

-- CreateIndex
CREATE INDEX "Message_whatsAppContactId_idx" ON "Message"("whatsAppContactId");

-- CreateIndex
CREATE INDEX "Message_status_idx" ON "Message"("status");

-- CreateIndex
CREATE INDEX "Message_scheduledFor_idx" ON "Message"("scheduledFor");

-- CreateIndex
CREATE INDEX "Message_marketingCampaignId_idx" ON "Message"("marketingCampaignId");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_readAt_idx" ON "Notification"("readAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "BotPause_resumeAt_idx" ON "BotPause"("resumeAt");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpConfig_patientId_key" ON "FollowUpConfig"("patientId");

-- CreateIndex
CREATE INDEX "FollowUpProgram_patientId_idx" ON "FollowUpProgram"("patientId");

-- CreateIndex
CREATE INDEX "FollowUpProgram_status_idx" ON "FollowUpProgram"("status");

-- CreateIndex
CREATE INDEX "FollowUpEvaluation_followUpId_idx" ON "FollowUpEvaluation"("followUpId");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationAttempt_phone_key" ON "RegistrationAttempt"("phone");

-- CreateIndex
CREATE INDEX "RegistrationAttempt_converted_contacted_createdAt_idx" ON "RegistrationAttempt"("converted", "contacted", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppContact_phone_key" ON "WhatsAppContact"("phone");

-- CreateIndex
CREATE INDEX "WhatsAppContact_converted_followUpStage_lastMessageAt_idx" ON "WhatsAppContact"("converted", "followUpStage", "lastMessageAt");

-- CreateIndex
CREATE INDEX "FinancialEntry_dueDate_idx" ON "FinancialEntry"("dueDate");

-- CreateIndex
CREATE INDEX "FinancialEntry_status_idx" ON "FinancialEntry"("status");

-- CreateIndex
CREATE INDEX "FinancialEntry_category_idx" ON "FinancialEntry"("category");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_financialEntryId_key" ON "Payment"("financialEntryId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_providerPaymentId_idx" ON "Payment"("providerPaymentId");

-- CreateIndex
CREATE INDEX "Payment_financialEntryId_idx" ON "Payment"("financialEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_provider_eventId_key" ON "PaymentWebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "AvailabilityRule_doctorId_weekday_idx" ON "AvailabilityRule"("doctorId", "weekday");

-- CreateIndex
CREATE INDEX "AvailabilityException_date_idx" ON "AvailabilityException"("date");

-- CreateIndex
CREATE INDEX "MedicalCertificate_userId_idx" ON "MedicalCertificate"("userId");

-- CreateIndex
CREATE INDEX "MedicalCertificate_status_idx" ON "MedicalCertificate"("status");

-- CreateIndex
CREATE INDEX "BirdIdCredential_userId_idx" ON "BirdIdCredential"("userId");

-- CreateIndex
CREATE INDEX "BirdIdCredential_status_idx" ON "BirdIdCredential"("status");

-- CreateIndex
CREATE INDEX "BirdIdSession_userId_idx" ON "BirdIdSession"("userId");

-- CreateIndex
CREATE INDEX "BirdIdSession_status_idx" ON "BirdIdSession"("status");

-- CreateIndex
CREATE INDEX "MarketingCampaign_status_idx" ON "MarketingCampaign"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "Coupon_enabled_idx" ON "Coupon"("enabled");

-- CreateIndex
CREATE INDEX "CouponUse_patientId_idx" ON "CouponUse"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "CouponUse_couponId_patientId_key" ON "CouponUse"("couponId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "CronRun_name_key" ON "CronRun"("name");

-- CreateIndex
CREATE INDEX "MessageFlow_kind_enabled_idx" ON "MessageFlow"("kind", "enabled");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapeuticPlan" ADD CONSTRAINT "TherapeuticPlan_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapeuticPlan" ADD CONSTRAINT "TherapeuticPlan_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_whatsAppContactId_fkey" FOREIGN KEY ("whatsAppContactId") REFERENCES "WhatsAppContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_marketingCampaignId_fkey" FOREIGN KEY ("marketingCampaignId") REFERENCES "MarketingCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpConfig" ADD CONSTRAINT "FollowUpConfig_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpProgram" ADD CONSTRAINT "FollowUpProgram_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpProgram" ADD CONSTRAINT "FollowUpProgram_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpEvaluation" ADD CONSTRAINT "FollowUpEvaluation_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUpProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpEvaluation" ADD CONSTRAINT "FollowUpEvaluation_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_financialEntryId_fkey" FOREIGN KEY ("financialEntryId") REFERENCES "FinancialEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUpProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalCertificate" ADD CONSTRAINT "MedicalCertificate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirdIdCredential" ADD CONSTRAINT "BirdIdCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirdIdSession" ADD CONSTRAINT "BirdIdSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponUse" ADD CONSTRAINT "CouponUse_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponUse" ADD CONSTRAINT "CouponUse_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponUse" ADD CONSTRAINT "CouponUse_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

