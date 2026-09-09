/**
 * Teste do novo primeiro atendimento do bot (preços → escolha → nome → agenda).
 * Executar com: npx tsx scripts/test-bot-precos.ts
 */
import { buildBotFlow } from "../lib/whatsapp/flow-defaults"
import { runBotFlow, type BotFlowContext, type BotState } from "../lib/whatsapp/flow-engine"

const flow = buildBotFlow({})
const ctx: BotFlowContext = {
  clinicName: "Clínica Teste",
  baseUrl: "https://painel.medicoemdomicilio.com",
  firstName: null,
  modalities: [
    { id: "DOMICILIAR", label: "Consulta domiciliar", price: 350 },
    { id: "TELECONSULTA", label: "Teleconsulta", price: 200 },
  ],
}

let failures = 0
function check(label: string, condition: boolean, extra?: unknown) {
  if (condition) {
    console.log(`✓ ${label}`)
  } else {
    failures++
    console.error(`✗ ${label}`, extra ?? "")
  }
}

function run(state: BotState, text: string) {
  return runBotFlow(state, text, ctx, flow)
}

// 1) Primeiro contato (desconhecido): portão de preços com botões.
const r1 = run("MENU", "oi, quanto custa?")
console.log("\n[1] Primeiro contato →", JSON.stringify(r1.reply))
check("1. Mostra os preços", r1.reply.includes("Consulta domiciliar") && r1.reply.includes("Teleconsulta"))
check("1. Preço formatado em BRL", r1.reply.includes("R$"))
check("1. Aguarda a escolha", r1.nextState === "AGUARDANDO_TIPO")
check("1. Botões de modalidade", (r1.buttons ?? []).length === 2)

// 2) Toque no botão "Consulta domiciliar" (o WhatsApp manda o label como texto).
const r2 = run("AGUARDANDO_TIPO", "Consulta domiciliar")
console.log("\n[2] Escolha domiciliar →", JSON.stringify(r2.reply))
check("2. Pede o nome completo", r2.reply.toLowerCase().includes("nome completo"))
check("2. Aguarda o nome", r2.nextState === "AGUARDANDO_NOME")
check("2. Modalidade capturada", r2.chosenModality === "DOMICILIAR")

// 3) Nome completo → mensagem da agenda com link.
const r3 = run("AGUARDANDO_NOME", "João da Silva Pereira")
console.log("\n[3] Nome →", JSON.stringify(r3.reply))
check("3. Confirma e avisa da agenda", r3.reply.includes("agenda"))
check("3. Link do cadastro", r3.reply.includes("/cadastro"))
check("3. Nome capturado", r3.capturedName === "João da Silva Pereira")
check("3. Volta ao menu", r3.nextState === "MENU")

// 4) Contato conhecido perguntando preço: ação VALORES vira escolha.
const namedCtx: BotFlowContext = { ...ctx, firstName: "Maria" }
const r4 = runBotFlow("MENU", "quanto custa?", namedCtx, flow, "menu")
console.log("\n[4] Preço (contato conhecido) →", JSON.stringify(r4.reply))
check("4. Mostra os preços", r4.reply.includes("Consulta domiciliar"))
check("4. Botões + aguarda escolha", (r4.buttons ?? []).length === 2 && r4.nextState === "AGUARDANDO_TIPO")

// 5) Contato conhecido escolhe teleconsulta: pula o nome e já manda a agenda.
const r5 = runBotFlow("AGUARDANDO_TIPO", "Teleconsulta", namedCtx, flow)
console.log("\n[5] Teleconsulta (nome conhecido) →", JSON.stringify(r5.reply))
check("5. Não pede nome de novo", !r5.reply.toLowerCase().includes("nome completo"))
check("5. Envia a agenda direto", r5.reply.includes("agenda") && r5.reply.includes("/cadastro"))
check("5. Modalidade capturada", r5.chosenModality === "TELECONSULTA")

// 6) Resposta não relacionada no portão cai no menu.
const r6 = run("AGUARDANDO_TIPO", "blablabla")
console.log("\n[6] Resposta qualquer →", JSON.stringify(r6.reply))
check("6. Cai no menu", r6.nextState === "MENU")

console.log(failures === 0 ? "\nTODOS OS TESTES PASSARAM ✓" : `\n${failures} TESTE(S) FALHARAM ✗`)
process.exit(failures === 0 ? 0 : 1)
