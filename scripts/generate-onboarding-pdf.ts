/**
 * Gera o PDF de onboarding do cliente (Guia de Ativação).
 *
 * Conteúdo: visão geral das funcionalidades, passo a passo para criar a conta
 * no Asaas e na W-API, contas de acesso para teste, checklist e referências.
 *
 * Identidade visual: cores institucionais da plataforma (azul PANTONE 2965 C
 * #00263E e bege PANTONE 4655 C #BE9272) e logo/nome da clínica buscados do
 * banco a cada geração (via .env) — o PDF sai sempre atualizado.
 *
 * Uso:    npx tsx scripts/generate-onboarding-pdf.ts
 * Saída:  onboarding-cliente.pdf (raiz do projeto)
 */
import PDFDocument from "pdfkit"
import fs from "node:fs"
import path from "node:path"
import { PrismaClient } from "@prisma/client"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import sharp from "sharp"
import type { LucideIcon } from "lucide-react"
import {
  BarChart3,
  CalendarDays,
  FileText,
  Globe,
  MapPinned,
  Megaphone,
  MessageCircle,
  Stethoscope,
  UserCog,
  Users,
  Wallet,
} from "lucide-react"

const OUT_FILE = path.resolve(process.cwd(), "onboarding-cliente.pdf")

// Cores institucionais (PANTONE 2965 C e 4655 C) + tons auxiliares
const NAVY = "#00263E"
const BEIGE = "#BE9272"
const BEIGE_LIGHT = "#F3EAE3"
const INK = "#1f2937"
const BODY = "#374151"
const MUTED = "#6b7280"
const LINE = "#e5e7eb"

/** Ordem de exibição dos perfis na tabela de acessos. */
const ROLE_ORDER = ["ADMIN", "MEDICO", "SECRETARIA", "FINANCEIRO"]
const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrador",
  MEDICO: "Médico",
  SECRETARIA: "Secretária/Recepção",
  FINANCEIRO: "Financeiro",
}

/** Senhas padrão das contas de demonstração (criadas pelo seed). */
const ACCOUNT_PASSWORDS: Record<string, string> = {
  ADMIN: "admin123",
  MEDICO: "medico123",
  SECRETARIA: "secreta123",
  FINANCEIRO: "financeiro123",
}

type DbData = {
  clinicName: string
  logo?: Buffer
  accounts: { name: string; email: string; role: string }[]
}

/** Busca logo, nome da clínica e contas de acesso no banco (via .env). */
async function loadDbData(): Promise<DbData> {
  try {
    process.loadEnvFile(path.join(process.cwd(), ".env"))
    const prisma = new PrismaClient()
    try {
      const clinic = await prisma.clinicSettings.findUnique({
        where: { id: 1 },
      })
      const users = await prisma.user.findMany({
        select: { name: true, email: true, role: true },
      })
      let logo: Buffer | undefined
      const match = /^data:image\/(png|jpe?g);base64,([\s\S]+)$/.exec(
        clinic?.logoDataUrl ?? ""
      )
      if (match) logo = Buffer.from(match[2], "base64")
      return {
        clinicName: clinic?.name?.trim() || "Médico em Domicílio",
        logo,
        accounts: users.sort(
          (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)
        ),
      }
    } finally {
      await prisma.$disconnect()
    }
  } catch (error) {
    console.warn(
      `Aviso: banco indisponível (${error instanceof Error ? error.message : error}) — gerando sem logo e sem contas.`
    )
    return { clinicName: "Médico em Domicílio", accounts: [] }
  }
}

/** Rasteriza um ícone do lucide (SVG → PNG navy) com cache por ícone/cor. */
const iconCache = new Map<string, Buffer>()
async function renderIcon(
  Icon: LucideIcon,
  color: string
): Promise<Buffer | null> {
  const key = `${Icon.displayName ?? "icon"}:${color}`
  const cached = iconCache.get(key)
  if (cached) return cached
  try {
    const svg = renderToStaticMarkup(
      createElement(Icon, { size: 48, strokeWidth: 2, color })
    )
    const png = await sharp(Buffer.from(svg)).resize(48, 48).png().toBuffer()
    iconCache.set(key, png)
    return png
  } catch (error) {
    console.warn(
      `Aviso: falha ao rasterizar ícone (${error instanceof Error ? error.message : error}) — usando marcador simples.`
    )
    return null
  }
}

async function main() {
  const db = await loadDbData()

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 56, bottom: 64, left: 56, right: 56 },
    info: {
      Title: "Guia de Ativação — Médico em Domicílio",
      Author: db.clinicName,
      Subject: "Onboarding do cliente: contas Asaas e W-API e funcionalidades",
    },
  })
  const out = fs.createWriteStream(OUT_FILE)
  doc.pipe(out)

  const left = (): number => doc.page.margins.left
  const right = (): number => doc.page.width - doc.page.margins.right
  const usable = (): number => right() - left()
  const centerX = (w: number): number => (doc.page.width - w) / 2

  /**
   * Rodapé + cabeçalho desenhados ao criar cada página.
   * IMPORTANTE (pdfkit 0.19): texto abaixo de page.maxY() dispara quebra de
   * página infinita — por isso todo texto do rodapé recebe a opção `height`,
   * que desativa o continueOnNewPage do LineWrapper. Texto acima da margem
   * superior (cabeçalho) não sofre essa restrição.
   *
   * O construtor do PDFDocument já cria a página 1 (capa) ANTES deste listener
   * ser registrado — por isso o contador começa em 1: o primeiro evento
   * recebido é o da página 2. A capa fica sem rodapé/cabeçalho (padrão).
   */
  let pageCounter = 1
  doc.on("pageAdded", () => {
    pageCounter++
    // Cabeçalho da clínica (logo + nome) acima da margem superior
    if (db.logo) {
      doc.image(db.logo, left(), 12, { fit: [62, 34] })
      doc.fontSize(10).font("Helvetica-Bold").fillColor(NAVY)
      doc.text(db.clinicName, left() + 72, 25, { width: usable() - 72 })
    }
    // Rodapé
    const y = doc.page.height - 40
    doc.moveTo(left(), y).lineTo(right(), y).strokeColor(LINE).stroke()
    doc.fontSize(8).font("Helvetica").fillColor(MUTED)
    doc.text(`Guia de Ativação — ${db.clinicName}`, left(), y + 8, {
      width: usable() / 2,
      align: "left",
      height: 12,
    })
    doc.text(`Página ${pageCounter}`, left() + usable() / 2, y + 8, {
      width: usable() / 2,
      align: "right",
      height: 12,
    })
    doc.fillColor(INK)
    doc.y = doc.page.margins.top
  })

  /** Garante espaço vertical; se não couber, quebra a página. */
  function ensureSpace(h: number): void {
    if (doc.y + h > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage()
    }
  }

  /** Cabeçalho de seção numerada com faixa colorida. Cada seção começa em
   * página própria (capa fica sozinha na página 1). */
  let sectionCounter = 0
  function sectionHeader(title: string, subtitle?: string): void {
    sectionCounter++
    doc.addPage()
    const y = doc.page.margins.top
    doc.roundedRect(left(), y, 34, 34, 6).fill(NAVY)
    doc.fontSize(18).font("Helvetica-Bold").fillColor("#ffffff")
    doc.text(String(sectionCounter), left(), y + 7, {
      width: 34,
      align: "center",
    })
    doc.fontSize(14).font("Helvetica-Bold").fillColor(NAVY)
    doc.text(title, left() + 46, y + 1)
    if (subtitle) {
      doc.fontSize(9.5).font("Helvetica").fillColor(MUTED)
      doc.text(subtitle, left() + 46, doc.y + 3, { width: usable() - 46 })
    }
    doc.y = y + 34 + 10
  }

  /** Parágrafo comum. */
  function paragraph(text: string): void {
    ensureSpace(30)
    doc.fontSize(10).font("Helvetica").fillColor(BODY)
    doc.text(text, left(), doc.y, { width: usable(), align: "justify" })
    doc.moveDown(0.6)
  }

  /**
   * Grade de funcionalidades (seção 1): duas colunas, ícone do lucide + título
   * em negrito + descrição, com espaçamento generoso entre os blocos.
   */
  type FeatureItem = { Icon: LucideIcon; bold: string; text: string }
  async function drawFeatureGrid(items: FeatureItem[]): Promise<void> {
    const gap = 18
    const colW = (usable() - gap) / 2
    const xs = [left(), left() + colW + gap]
    const startY = doc.y
    const maxBottom = doc.page.height - doc.page.margins.bottom - 20
    const colY = [startY, startY]

    for (let i = 0; i < items.length; i++) {
      const col = i % 2
      const item = items[i]

      doc.fontSize(9.8)
      const textH = doc.heightOfString(`${item.bold}${item.text}`, {
        width: colW - 22,
        lineGap: 1.4,
      })
      const blockH = Math.max(16, textH) + 12
      if (colY[col] + blockH > maxBottom) {
        doc.addPage()
        colY[0] = doc.page.margins.top
        colY[1] = doc.page.margins.top
      }

      const x = xs[col]
      const y = colY[col]
      const icon = await renderIcon(item.Icon, NAVY)
      if (icon) {
        doc.image(icon, x, y + 1, { fit: [13, 13] })
      } else {
        doc.fontSize(10).font("Helvetica").fillColor(BEIGE)
        doc.text("•", x + 2, y - 2, { width: 12 })
      }

      doc.fontSize(9.8).fillColor(INK)
      doc.font("Helvetica-Bold").text(item.bold, x + 20, y, {
        width: colW - 22,
        lineGap: 1.4,
        continued: true,
      })
      doc.font("Helvetica").fillColor(BODY).text(item.text)
      colY[col] = y + Math.max(textH, 14) + 12
    }

    doc.y = Math.max(colY[0], colY[1])
    doc.fillColor(INK)
  }

  /** Passo numerado com título e linhas de instrução. */
  function step(n: number, title: string, lines: string[]): void {
    ensureSpace(52)
    const y = doc.y
    doc.circle(left() + 10, y + 10, 10).fill(BEIGE_LIGHT).stroke(BEIGE)
    doc.fontSize(10).font("Helvetica-Bold").fillColor(NAVY)
    doc.text(String(n), left() + 3, y + 5, { width: 14, align: "center" })
    doc.fontSize(10.5).font("Helvetica-Bold").fillColor(INK)
    doc.text(title, left() + 28, y + 3, { width: usable() - 28 })
    doc.fontSize(9.5).font("Helvetica").fillColor(BODY)
    for (const line of lines) {
      doc.moveDown(0.15)
      doc.text(line, left() + 28, doc.y, { width: usable() - 28 })
    }
    doc.y += 12
  }

  /** Item de checklist (quadradinho + texto). */
  function checkItem(text: string, boldPrefix?: string): void {
    ensureSpace(22)
    const y = doc.y
    doc.roundedRect(left(), y, 12, 12, 2).stroke(NAVY)
    doc.fontSize(9.5).fillColor(INK)
    if (boldPrefix) {
      doc.font("Helvetica-Bold").text(boldPrefix, left() + 20, y - 1, {
        width: usable() - 20,
        continued: true,
      })
      doc.font("Helvetica").fillColor(BODY).text(text)
    } else {
      doc.font("Helvetica").fillColor(BODY).text(text, left() + 20, y - 1, {
        width: usable() - 20,
      })
    }
    doc.y += 4
  }

  /** Linha de referência com link clicável. */
  function referenceLink(label: string, url: string): void {
    ensureSpace(20)
    doc.fontSize(10).font("Helvetica").fillColor(INK)
    doc.text(label, left(), doc.y, { width: 200 })
    doc.fontSize(9.5).font("Helvetica").fillColor(NAVY)
    doc.text(url, left() + 210, doc.y - 11, {
      width: usable() - 210,
      link: url,
      underline: true,
    })
    doc.y += 4
  }

  /** Tabela de contas de acesso: cabeçalho navy e linhas alternadas. */
  function drawAccessTable(
    rows: { role: string; name: string; email: string }[]
  ): void {
    const colRole = 130
    const colEmail = 190
    const colPass = usable() - colRole - colEmail

    const drawHeader = () => {
      const y = doc.y
      doc.roundedRect(left(), y, usable(), 22, 3).fill(NAVY)
      doc.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff")
      doc.text("Perfil", left() + 8, y + 6, { width: colRole - 8 })
      doc.text("E-mail", left() + colRole + 8, y + 6, { width: colEmail - 8 })
      doc.text("Senha inicial", left() + colRole + colEmail + 8, y + 6, {
        width: colPass - 8,
      })
      doc.fillColor(INK)
      doc.y = y + 22
    }

    drawHeader()
    rows.forEach((account, i) => {
      ensureSpace(24)
      const y = doc.y
      if (i % 2 === 0) {
        doc.rect(left(), y, usable(), 22).fill(BEIGE_LIGHT)
      }
      const pass = ACCOUNT_PASSWORDS[account.role]
      doc.fontSize(9).font("Helvetica").fillColor(INK)
      doc.text(ROLE_LABELS[account.role] ?? account.role, left() + 8, y + 6, {
        width: colRole - 8,
      })
      doc.text(account.email, left() + colRole + 8, y + 6, {
        width: colEmail - 8,
      })
      doc.font("Helvetica").fillColor(BODY)
      doc.text(pass ?? "—", left() + colRole + colEmail + 8, y + 6, {
        width: colPass - 8,
      })
      doc.fillColor(INK)
      doc.y = y + 22
    })
    doc.moveDown(0.8)
  }

  /* ---------------------------------------------------------------- */
  /* CAPA                                                              */
  /* ---------------------------------------------------------------- */
  const bandHeight = 200
  doc.rect(0, 0, doc.page.width, bandHeight).fill(NAVY)
  doc.rect(0, bandHeight, doc.page.width, 6).fill(BEIGE)
  doc.fontSize(24).font("Helvetica-Bold").fillColor("#ffffff")
  doc.text(db.clinicName.toUpperCase(), left(), 84, {
    width: usable(),
    align: "center",
  })
  doc.fontSize(11).font("Helvetica").fillColor(BEIGE)
  doc.text(
    "Plataforma de gestão para atendimento clínico presencial e em domicílio",
    left(),
    doc.y + 8,
    { width: usable(), align: "center" }
  )

  let coverY = bandHeight + 26
  if (db.logo) {
    doc.image(db.logo, centerX(170), coverY, { fit: [170, 95] })
    coverY += 110
  } else {
    coverY += 30
  }

  doc.fillColor(NAVY)
  doc.fontSize(22).font("Helvetica-Bold")
  doc.text("Guia de Ativação do Cliente", left(), coverY, {
    width: usable(),
    align: "center",
  })
  doc.fontSize(11).font("Helvetica").fillColor(MUTED)
  doc.text(
    "Criação das contas (Asaas e W-API), acesso de teste e visão geral das funcionalidades",
    left(),
    doc.y + 8,
    { width: usable(), align: "center" }
  )
  doc.fontSize(10).font("Helvetica")
  doc.text("Agosto de 2026", left(), doc.y + 16, {
    width: usable(),
    align: "center",
  })

  doc.fontSize(10).font("Helvetica").fillColor(BODY)
  doc.text("Neste guia:", left(), doc.y + 30)
  const summaryItems = [
    "1.  O que a plataforma faz — síntese das funcionalidades",
    "2.  Ativação do Asaas — conta de pagamentos (PIX e cartão)",
    "3.  Ativação da W-API — conexão do WhatsApp",
    "4.  Acesso de teste — contas de demonstração",
    "5.  Checklist de ativação",
    "6.  Referências e links úteis",
  ]
  for (const item of summaryItems) {
    doc.text(item, left() + 16, doc.y + 6, { width: usable() - 16 })
  }
  doc.y += 20
  doc.fontSize(9).font("Helvetica").fillColor(MUTED)
  doc.text(
    "Painel da plataforma: https://painel.medicoemdomicilio.com",
    left(),
    doc.y + 8,
    {
      width: usable(),
      link: "https://painel.medicoemdomicilio.com",
      underline: true,
    }
  )

  /* ---------------------------------------------------------------- */
  /* 1. VISÃO GERAL                                                    */
  /* ---------------------------------------------------------------- */
  sectionHeader(
    "O que a plataforma faz",
    "Síntese das funcionalidades — um painel único para a operação da clínica"
  )
  paragraph(
    "A plataforma Médico em Domicílio centraliza a operação da clínica em um único painel web: " +
      "do agendamento à cobrança, passando pelo atendimento em domicílio, o prontuário, as " +
      "prescrições, o WhatsApp e o financeiro. Tudo é acessível pelo navegador, inclusive pelo celular."
  )
  await drawFeatureGrid([
    {
      Icon: CalendarDays,
      bold: "Agenda multi-médico: ",
      text: "agenda compartilhada com vários médicos, cada um com a própria grade. " +
        "Consultas presenciais, domiciliares ou por vídeo, com valores por modalidade.",
    },
    {
      Icon: Globe,
      bold: "Agendamento online: ",
      text: "o paciente agenda sozinho pelo portal público, escolhe a modalidade e " +
        "vê o preço antes de confirmar.",
    },
    {
      Icon: MapPinned,
      bold: "Atendimentos do dia: ",
      text: "rota dos atendimentos com o botão “Iniciar atendimento” e aviso automático " +
        "ao paciente (“o médico está a caminho”).",
    },
    {
      Icon: Users,
      bold: "Pacientes: ",
      text: "cadastro completo com consentimento LGPD e vínculo com o médico responsável.",
    },
    {
      Icon: Stethoscope,
      bold: "Prontuário: ",
      text: "evolução, prescrição e plano terapêutico no mesmo fluxo, com formulários " +
        "otimizados para uso no celular durante a visita.",
    },
    {
      Icon: FileText,
      bold: "Prescrições e planos: ",
      text: "prescrições em PDF com assinatura digital (padrão PAdES) e plano " +
        "terapêutico resumido com apoio de IA.",
    },
    {
      Icon: MessageCircle,
      bold: "WhatsApp com bot: ",
      text: "chat direto com o paciente e atendimento automático: agendar, consultar " +
        "por CPF, remarcar, informar endereço e encaminhar para um humano.",
    },
    {
      Icon: Megaphone,
      bold: "Automações e marketing: ",
      text: "lembretes e mensagens programadas e campanhas em massa segmentadas por público.",
    },
    {
      Icon: Wallet,
      bold: "Financeiro: ",
      text: "contas a receber e a pagar, PIX e cartão (Asaas), Apple Pay (Stripe) e baixa " +
        "automática quando o paciente paga.",
    },
    {
      Icon: BarChart3,
      bold: "Relatórios: ",
      text: "relatório financeiro em PDF com a marca da clínica e indicadores no painel.",
    },
    {
      Icon: UserCog,
      bold: "Equipe e acessos: ",
      text: "perfis separados — administrador, médico, secretária e financeiro — cada um " +
        "vê apenas as áreas do seu trabalho.",
    },
  ])

  /* ---------------------------------------------------------------- */
  /* 2. ASAAS                                                          */
  /* ---------------------------------------------------------------- */
  sectionHeader(
    "Ativação do Asaas (pagamentos)",
    "Conta que processa PIX e cartão de crédito — cadastro gratuito"
  )
  paragraph(
    "O Asaas é a conta de pagamentos usada pela plataforma para gerar cobranças por PIX e por cartão " +
      "de crédito. O cadastro é gratuito e não tem mensalidade — há apenas a taxa cobrada por cada " +
      "pagamento recebido. Sem a conta, as cobranças ficam em modo de teste."
  )
  step(1, "Crie a conta no Asaas", [
    "Acesse o site do Asaas e clique em “Criar conta grátis”.",
    "O cadastro pode ser pessoa física ou jurídica; informe os dados solicitados e confirme o e-mail.",
  ])
  step(2, "Obtenha a chave de API", [
    "No painel do Asaas, acesse Configurações > Chaves de API.",
    "Copie a “Chave de API” do ambiente de Produção. Para treinar antes de receber pagamentos reais, " +
      "use a chave do ambiente Sandbox e troque depois.",
  ])
  step(3, "Cadastre a chave na plataforma", [
    "No painel da clínica, entre em Configurações > Pagamentos.",
    "Cole a chave no campo do Asaas e clique em “Testar conexão” — deve exibir sucesso.",
  ])
  step(4, "Ative o webhook (baixa automática)", [
    "No Asaas: Configurações > Webhooks > cadastre uma nova notificação com a URL abaixo:",
    "https://painel.medicoemdomicilio.com/api/webhooks/asaas",
    "Marque os eventos de pagamento (PAYMENT_RECEIVED, PAYMENT_CONFIRMED, PAYMENT_OVERDUE, " +
      "PAYMENT_DELETED e PAYMENT_REFUNDED). Com isso, todo pagamento confirmado baixa o lançamento " +
      "automaticamente no Financeiro.",
  ])
  step(5, "Pronto para cobrar", [
    "No Financeiro, ao clicar em “Cobrar”, a plataforma gera o PIX (QR code + copia-e-cola) ou o link " +
      "de pagamento do cartão pelo Asaas e já oferece o envio do link pelo WhatsApp.",
  ])

  /* ---------------------------------------------------------------- */
  /* 3. W-API                                                          */
  /* ---------------------------------------------------------------- */
  sectionHeader(
    "Ativação da W-API (WhatsApp)",
    "Serviço que conecta o WhatsApp da clínica à plataforma"
  )
  paragraph(
    "A W-API é o serviço que liga o número de WhatsApp da clínica à plataforma: é por ela que saem as " +
      "mensagens, o bot de atendimento responde os pacientes e as automações e campanhas são enviadas."
  )
  step(1, "Crie a conta na W-API", [
    "Acesse o site da W-API e registre-se. A conta é gratuita; a assinatura é por instância (número conectado).",
  ])
  step(2, "Crie a instância", [
    "No painel da W-API, crie uma nova “Instância” para o número oficial da clínica.",
    "Cada instância representa um número de WhatsApp — crie uma para o número usado no atendimento.",
  ])
  step(3, "Conecte o número pelo QR code", [
    "Leia o QR code da instância com o WhatsApp do celular do número escolhido (menu Aparelhos " +
      "conectados), da mesma forma que o WhatsApp Web.",
  ])
  step(4, "Mantenha a assinatura ativa", [
    "Importante: a instância precisa de um plano ativo para funcionar. Sem assinatura, a API bloqueia " +
      "os envios. Renove o plano no próprio painel da W-API.",
  ])
  step(5, "Copie as credenciais da instância", [
    "No painel da instância, copie o ID da instância (instanceId) e o token (chave de API).",
  ])
  step(6, "Cadastre na plataforma", [
    "No painel da clínica: Configurações > Integrações > cole o ID da instância e o token nos campos " +
      "da W-API e clique em “Testar conexão”.",
  ])
  step(7, "Ative o webhook de recebimento", [
    "No painel da W-API, configure o webhook da instância com a URL abaixo:",
    "https://painel.medicoemdomicilio.com/api/webhooks/whatsapp",
    "É por esse endereço que a plataforma recebe as mensagens dos pacientes e o bot responde sozinho.",
  ])
  step(8, "Teste o funcionamento", [
    "Envie um “oi” do seu WhatsApp para o número da clínica: o bot deve responder com o menu de " +
      "atendimento automático.",
  ])

  /* ---------------------------------------------------------------- */
  /* 4. ACESSO DE TESTE                                                */
  /* ---------------------------------------------------------------- */
  sectionHeader(
    "Acesso de teste",
    "Contas de demonstração para conhecer a plataforma antes da ativação"
  )
  paragraph(
    "A clínica pode explorar o sistema imediatamente usando as contas de demonstração abaixo. " +
      "Cada perfil enxerga apenas as áreas do seu trabalho — vale navegar com os quatro para ver a " +
      "diferença de visões."
  )
  referenceLink("Painel da plataforma", "https://painel.medicoemdomicilio.com")
  doc.moveDown(0.8)
  if (db.accounts.length > 0) {
    drawAccessTable(db.accounts)
  } else {
    paragraph(
      "As contas de acesso serão entregues pela equipe de implantação no momento da ativação."
    )
  }
  paragraph(
    "As senhas acima são provisórias e devem ser alteradas no primeiro acesso. O portal público do " +
      "paciente também pode ser testado em https://painel.medicoemdomicilio.com/cadastro — é por ele " +
      "que o paciente faz o pré-cadastro e agenda consultas."
  )

  /* ---------------------------------------------------------------- */
  /* 5. CHECKLIST                                                      */
  /* ---------------------------------------------------------------- */
  sectionHeader("Checklist de ativação", "Confira item por item para liberar a operação")
  checkItem("Conta criada no Asaas.", "Asaas: ")
  checkItem("Chave de API do Asaas colada na plataforma e teste de conexão com sucesso.")
  checkItem("Webhook do Asaas configurado (pagamentos baixam automaticamente).")
  checkItem("Conta criada na W-API.", "W-API: ")
  checkItem("Instância criada e número de WhatsApp conectado pelo QR code.")
  checkItem("Assinatura da instância ativa.")
  checkItem("ID da instância e token colados na plataforma e teste com sucesso.")
  checkItem("Webhook do WhatsApp configurado.")
  checkItem("Teste de mensagem realizado (envio e resposta do bot).")
  doc.moveDown(1)
  paragraph(
    "Depois do checklist concluído, a equipe de implantação acompanha os primeiros agendamentos, " +
      "cobranças e mensagens reais junto com a clínica."
  )

  /* ---------------------------------------------------------------- */
  /* 6. REFERÊNCIAS                                                    */
  /* ---------------------------------------------------------------- */
  sectionHeader("Referências", "Endereços oficiais da plataforma e dos serviços")
  referenceLink("Painel da plataforma", "https://painel.medicoemdomicilio.com")
  referenceLink("Portal do paciente (pré-cadastro)", "https://painel.medicoemdomicilio.com/cadastro")
  referenceLink("Asaas — site", "https://www.asaas.com")
  referenceLink("Asaas — documentação da API", "https://docs.asaas.com")
  referenceLink("W-API — site", "https://w-api.app")
  referenceLink("W-API — documentação", "https://docs.w-api.app")
  doc.moveDown(2)
  doc.fontSize(8.5).font("Helvetica").fillColor(MUTED)
  doc.text(
    `Documento gerado em agosto de 2026 pela equipe de implantação da plataforma ${db.clinicName}.`,
    { align: "center" }
  )

  doc.end()
  return new Promise<void>((resolve) => out.on("finish", () => resolve()))
}

main()
  .then(() => console.log(`PDF gerado: ${OUT_FILE}`))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
