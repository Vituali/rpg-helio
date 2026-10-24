/**
 * Teste do Selo da Missão (entrega 3 do ADR #18).
 *
 * Prova o que o selo promete:
 *   - criar missão é ato deliberado e exige conta;
 *   - o selo é gerado no formato ditável (TRES-PALAVRAS-DD) e é único;
 *   - selo conhecido entra (inclusive digitado em minúscula ou com acento);
 *   - selo desconhecido **não entra e não cria nada**;
 *   - a conta dona entra como mestre sem senha, e só ela apaga a missão;
 *   - apagar tira o selo do ar, e a missão some da lista.
 *
 * Desde a entrega 5 a mesa exige conta (ADR #20): quem entra pelo selo é uma
 * **conta de agente**, e o nome na mesa é o nome dela — não se digita nada.
 *
 * O teste cria as missões de que precisa e **apaga no fim**.
 *
 *   npm start
 *   URL=http://localhost SEED_MASTER_USER=helio SEED_MASTER_PASS=123456 npm run selo
 */

import { TEST_ACCOUNT, deleteTestAccount, testAccount } from "./harness.mjs";

const URL = (process.env.URL ?? "http://localhost").replace(/\/+$/, "");
const USER = process.env.SEED_MASTER_USER ?? "helio";
const PASS = process.env.SEED_MASTER_PASS ?? "123456";

/** O formato que o selo promete: três palavras e dois dígitos. */
const SELO_SHAPE = /^[A-Z]{3,7}-[A-Z]{3,7}-[A-Z]{3,7}-[0-9]{2}$/;

let failures = 0;
function check(ok, label) {
  console.log(`${ok ? "  ok  " : "  FALHA"}  ${label}`);
  if (!ok) failures += 1;
}
function skip(label) {
  console.log(`  --    ${label}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, path, { body, cookie } = {}) {
  const res = await fetch(`${URL}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, res };
}

function cookieOf(res) {
  const all = res.headers.getSetCookie?.() ?? [];
  return all[0] ? all[0].split(";")[0] : "";
}

/** O socket.io-client do Node não tem cookie jar: o cookie vai na mão. */
async function join(code, { cookie, key = "" } = {}) {
  const { io } = await import("socket.io-client");
  const socket = io(URL, {
    transports: ["websocket"],
    extraHeaders: cookie ? { Cookie: cookie } : {},
  });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const ack = await new Promise((resolve) => {
    // Sem nome e sem papel: quem entra é a conta do cookie (ADR #20).
    socket.emit("room:join", { code, key }, resolve);
  });
  const me = ack?.ok ? ack.players.find((p) => p.id === ack.you) : null;
  return { socket, ack, me };
}

// ── Roteiro ──────────────────────────────────────────────────────────────────

console.log(`URL: ${URL}\n`);

// 1) Criar, listar e apagar exigem conta (ADR #18)
const anonCreate = await http("POST", "/api/campaigns", { body: { name: "invasao" } });
check(anonCreate.status === 401, "criar missão sem conta é recusado (401)");
const anonList = await http("GET", "/api/campaigns");
check(anonList.status === 401, "listar missões sem conta é recusado (401)");
const anonDelete = await http("DELETE", "/api/campaigns/QUALQUER-UM-42");
check(anonDelete.status === 401, "apagar missão sem conta é recusado (401)");

// 2) A conta do mestre entra
const login = await http("POST", "/api/auth/login", { body: { name: USER, password: PASS } });
if (!login.body?.ok) {
  console.error(`\nNão deu para entrar como "${USER}". O teste precisa da conta-semente.`);
  process.exit(1);
}
const cookie = cookieOf(login.res);
console.log(`conta: ${login.body.account.name}\n`);

// 3) Criar missão — ou descobrir que o banco está fora
const missao = await http("POST", "/api/campaigns", {
  body: { name: "A Maldição de Veríssimo" },
  cookie,
});

const dbDown = missao.status === 503;
if (dbDown) {
  skip("banco indisponível: sem lista, sem criar, sem apagar");
  // O outro lado do ADR #17: com o banco fora o selo não pode ser julgado — e a
  // mesa tem que abrir do mesmo jeito, com um selo qualquer. A sessão é
  // assinada e não mora no banco, então o cookie do login continua valendo.
  const solto = await join(`MEMORIA-${Math.floor(Math.random() * 1e6)}`, { cookie });
  check(solto.ack?.ok === true, "com o banco fora, a mesa abre em memória");
  solto.socket.disconnect();
  console.log(`\n${failures === 0 ? "TUDO OK" : `${failures} FALHA(S)`} (modo sem banco)`);
  process.exit(failures === 0 ? 0 : 1);
}

const selo = missao.body?.campaign?.code ?? "";
check(missao.status === 201 && missao.body?.ok === true, "a conta dona criou uma missão");
check(SELO_SHAPE.test(selo), `o selo saiu no formato ditável: ${selo}`);
check(
  missao.body?.campaign?.name === "A Maldição de Veríssimo",
  "o nome da missão foi guardado (e é separado do selo)",
);

// 4) Outro nome → outro selo (e os dois aparecem na lista)
const outra = await http("POST", "/api/campaigns", { body: { name: "Ensaio" }, cookie });
const selo2 = outra.body?.campaign?.code ?? "";
check(selo2 !== "" && selo2 !== selo, `dois sorteios não repetem (${selo2})`);

// 5) Nome vazio não impede criar
const semNome = await http("POST", "/api/campaigns", { body: {}, cookie });
check(semNome.status === 201, "missão sem nome também é criada");

const lista = await http("GET", "/api/campaigns", { cookie });
const codes = (lista.body?.campaigns ?? []).map((c) => c.code);
check(
  [selo, selo2, semNome.body?.campaign?.code].every((c) => codes.includes(c)),
  "a lista traz as missões da conta",
);
check(
  (lista.body?.campaigns ?? []).some((c) => c.name === "A Maldição de Veríssimo"),
  "a lista traz o nome da missão, não só o selo",
);

// 6) Selo conhecido entra — e quem entra pelo selo é um agente
//
// A conta é a porta (ADR #20): o agente precisa de conta, e é o nome dela que a
// mesa mostra. Não existe mais entrar só com um nome digitado.
const agente = await testAccount(URL);
if (!agente.cookie) {
  console.error(`\nNão deu para criar/entrar na conta de teste "${TEST_ACCOUNT}".`);
  process.exit(1);
}
const convidado = await join(selo, { cookie: agente.cookie });
check(convidado.ack?.ok === true, "a conta do agente entra com o selo");
check(convidado.me?.role === "player", "e é jogador, não mestre");
check(convidado.me?.name === TEST_ACCOUNT, "com o nome da conta, não um nome digitado");
convidado.socket.disconnect();

// 7) Digitar em minúscula, ou com acento, cai na mesma mesa
await sleep(300);
const minusculo = await join(selo.toLowerCase(), { cookie: agente.cookie });
check(
  minusculo.ack?.ok === true && minusculo.ack.code === selo,
  "selo digitado em minúscula entra na mesma mesa",
);
minusculo.socket.disconnect();

// 8) Selo desconhecido NÃO entra (nem para quem tem conta)
await sleep(300);
const errado = await join("TREVOSO-NADA-AQUI-99", { cookie: agente.cookie });
check(errado.ack?.ok === false, "selo desconhecido é recusado");
check(
  /desconhecido/i.test(String(errado.ack?.error ?? "")),
  "e o motivo diz que o selo é desconhecido",
);
errado.socket.disconnect();

// 9) E não cria nada: a lista não mudou
const depois = await http("GET", "/api/campaigns", { cookie });
check(
  (depois.body?.campaigns ?? []).length === (lista.body?.campaigns ?? []).length,
  "selo desconhecido não criou campanha nenhuma",
);

// 10) A conta dona entra como mestre, sem chave
await sleep(300);
const mestre = await join(selo, { cookie });
check(mestre.ack?.ok === true, "a conta dona entrou como mestre sem senha");
check(mestre.me?.role === "gm", "e o papel é mestre");
check(mestre.ack?.name === "A Maldição de Veríssimo", "a mesa carrega o nome da missão");
mestre.socket.disconnect();

// 11) Apagar: só o dono, e o selo sai do ar
const estranho = await http("DELETE", "/api/campaigns/SELO-DE-NINGUEM-77", { cookie });
check(estranho.status === 404, "apagar missão de outro devolve 404 (nem revela se existe)");

const apagou = await http("DELETE", `/api/campaigns/${selo}`, { cookie });
check(apagou.status === 200, "o dono apagou a missão");

await sleep(300);
const fantasma = await join(selo, { cookie: agente.cookie });
check(fantasma.ack?.ok === false, "o selo apagado deixou de funcionar");
fantasma.socket.disconnect();

const final = await http("GET", "/api/campaigns", { cookie });
const restantes = (final.body?.campaigns ?? []).map((c) => c.code);
check(!restantes.includes(selo), "e a missão sumiu da lista");

// Limpeza: o teste não deixa lixo para trás. Com o cadastro fechado, a conta de
// teste é **fixture** — sem ela a próxima execução não teria como criar uma.
const lixo = [selo2, semNome.body?.campaign?.code].filter(Boolean);
for (const c of lixo) {
  if (restantes.includes(c)) await http("DELETE", `/api/campaigns/${c}`, { cookie });
}
const eu = await http("GET", "/api/auth/me");
if (eu.body?.signup === true) deleteTestAccount();

console.log(`\n${failures === 0 ? "TUDO OK" : `${failures} FALHA(S)`}`);
process.exit(failures === 0 ? 0 : 1);
