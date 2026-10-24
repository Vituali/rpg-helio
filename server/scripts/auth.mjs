/**
 * Teste de contas, vínculo, papel e sessão (entregas 2, 4 e 5 — ADRs #16, #19,
 * #20 e #22).
 *
 * Prova o que a conta promete agora:
 *   - a conta entra com usuário e senha;
 *   - dá para **criar a própria conta**, e o cadastro já sai logado;
 *   - o cookie de sessão identifica a conexão **no handshake** (sem mensagem);
 *   - **sem conta não se entra na mesa** (ADR #20) — nem como convidado;
 *   - **ser mestre vem do vínculo com a missão**, não de "ser dono" nem de pedir:
 *     quem criou entra como mestre com a chave errada no bolso;
 *   - **o mestre pode dar o papel** a um agente, e vale **na hora** (ADR #22);
 *   - o dono não é rebaixável;
 *   - cair e voltar mantém o mesmo papel e o mesmo nome.
 *
 *   npm start
 *   SEED_MASTER_USER=helio SEED_MASTER_PASS=123456 npm run auth
 */

import {
  TEST_ACCOUNT,
  api,
  deleteTestAccount,
  testAccount,
  testCampaign,
} from "./harness.mjs";

const URL = process.env.URL ?? "http://localhost";
const USER = process.env.SEED_MASTER_USER ?? "helio";
const PASS = process.env.SEED_MASTER_PASS ?? "123456";
/** Missão descartável deste teste: criada aqui e apagada no fim (ADR #18). */
const missao = await testCampaign(URL, "AUTH");
const ROOM = missao.code;

let failures = 0;
function check(ok, label) {
  console.log(`${ok ? "  ok  " : "  FALHA"}  ${label}`);
  if (!ok) failures += 1;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, label, tries = 80) {
  for (let i = 0; i < tries; i += 1) {
    if (fn()) return true;
    await sleep(50);
  }
  throw new Error(`timeout esperando: ${label}`);
}

async function post(path, body, cookie) {
  const res = await fetch(`${URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => null), res };
}

async function get(path, cookie) {
  const res = await fetch(`${URL}${path}`, { headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** O `name=value` do primeiro cookie, sem atributos. */
function cookieOf(res) {
  const all = res.headers.getSetCookie?.() ?? [];
  const first = all[0];
  return first ? first.split(";")[0] : "";
}

/**
 * Entra na mesa. Não manda nome nem papel: o servidor sabe quem é pelo cookie e
 * decide o papel pelo vínculo (ADR #20). `key` só existe para a escapatória.
 */
async function joinAs({ cookie, key = "" } = {}) {
  const { io } = await import("socket.io-client");
  const socket = io(URL, {
    transports: ["websocket"],
    extraHeaders: cookie ? { Cookie: cookie } : {},
  });
  const state = { last: null, errors: [] };
  socket.on("room:state", (st) => {
    state.last = st;
  });
  socket.on("error", (e) => state.errors.push(e));

  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });

  const ack = await new Promise((resolve) => {
    socket.emit("room:join", { code: ROOM, key }, (s) => {
      if (s?.ok) state.last = s;
      resolve(s);
    });
  });
  const me = ack?.ok ? ack.players.find((p) => p.id === ack.you) : null;
  return { socket, ack, state, me };
}

const papelAoVivo = (c, nome) => c.state.last?.players.find((p) => p.name === nome)?.role;

// ── Roteiro ──────────────────────────────────────────────────────────────────

// 1) quem sou eu, sem cookie
const anon = await get("/api/auth/me");
check(anon.body?.ok === false, "sem cookie, /api/auth/me não conhece ninguém");

// 2) senha errada não entra
const errada = await post("/api/auth/login", { name: USER, password: "senha-errada" });
check(errada.status === 401, "senha errada é recusada com 401");

// 3) usuário que não existe devolve a MESMA resposta (não entrega quem existe)
const inexistente = await post("/api/auth/login", { name: "ninguem-aqui", password: "x" });
check(
  inexistente.status === 401 && inexistente.body?.error === errada.body?.error,
  "usuário inexistente responde igual a senha errada",
);

// 4) login de verdade
const login = await post("/api/auth/login", { name: USER, password: PASS });
check(login.status === 200 && login.body?.ok === true, `a conta "${USER}" entrou`);
check(login.body?.account?.name === USER, "o servidor devolveu o nome da conta");
const cookie = cookieOf(login.res);
check(cookie.includes("helio_session="), "o servidor mandou o cookie de sessão");

// 4b) pela internet, o cookie é `Secure`.
// Atrás do túnel o app recebe HTTP puro do Caddy, então isto só passa se o
// servidor reconhecer que a requisição veio da borda HTTPS (ver `isSecure`).
if (URL.startsWith("https://")) {
  const setCookie = (login.res.headers.getSetCookie?.() ?? [])[0] ?? "";
  check(setCookie.includes("Secure"), "pela internet, o cookie sai com Secure");
}

// 5) quem sou eu, com cookie
const eu = await get("/api/auth/me", cookie);
check(eu.body?.ok === true && eu.body.account.name === USER, "/api/auth/me reconhece a conta");

// 6) sem conta, a mesa não abre (ADR #20)
//
// Era o caminho do convidado até a entrega 4. Com o papel vindo do vínculo e o
// nome vindo da conta, o convidado não tinha como ser promovido nem como ser
// encontrado — fechou.
const convidado = await joinAs({ key: "" });
check(convidado.ack?.ok === false, "sem conta não se entra na mesa");
check(
  /conta/i.test(convidado.ack?.error ?? ""),
  `a recusa diz o motivo ("${convidado.ack?.error ?? "?"}")`,
);
convidado.socket.disconnect();

// 7) o VÍNCULO dá o papel de mestre — e é só ele: a chave vai errada de propósito
//
// Com a chave errada no bolso, a única explicação para o `gm` aceito é o vínculo
// (e o servidor não pede papel nenhum: ele decide).
const gm = await joinAs({ cookie, key: "nao-e-a-chave" });
check(gm.ack?.ok === true, "o vínculo de mestre abre a mesa sem depender da chave");
check(gm.me?.role === "gm", "o papel é mestre");
check(gm.me?.accountId === login.body.account.id, "o jogador carrega o id da conta");
check(gm.me?.name === USER, "o nome veio da conta");

// 8) cair e voltar mantém quem você é — o fim do "id do socket"
gm.socket.disconnect();
await sleep(400);
const voltou = await joinAs({ cookie, key: "nao-e-a-chave" });
check(voltou.ack?.ok === true, "voltou e foi reconhecido como mestre de novo");
check(
  voltou.me?.accountId === gm.me?.accountId && voltou.me?.name === USER,
  "e é a MESMA conta, com o mesmo nome",
);
voltou.socket.disconnect();

// 9) sem chave configurada, chave nenhuma vira mestre (ADR #20)
if ((process.env.GM_KEY ?? "") === "") {
  const conta = await testAccount(URL);
  if (conta.cookie) {
    const inventada = await joinAs({ cookie: conta.cookie, key: "qualquer-chave" });
    check(inventada.ack?.ok === false, "sem GM_KEY no servidor, chave inventada não promove");
    inventada.socket.disconnect();
  }
}

// ── Cadastro e vínculo (entrega 4 — ADR #19) ─────────────────────────────────

// 10) cadastro: senha curta é recusada antes de qualquer coisa
const curta = await post("/api/accounts", { name: TEST_ACCOUNT, password: "123" });
check(curta.status === 400, "cadastro com senha curta é recusado com 400");

// 11) cadastro: repetir um nome existente é recusado — e aqui o nome repetido é
// dito na cara, ao contrário do login.
const repetido = await post("/api/accounts", { name: USER, password: "qualquer-senha" });
check(repetido.status === 409, "cadastro com nome já tomado é recusado com 409");

// 12) cadastro de verdade: cria, já sai logada, e o nome sai do banco
const conta = await testAccount(URL);
const cookieB = conta.cookie ?? "";

if (cookieB === "") {
  console.log(
    "  nota: cadastro indisponível (banco fora, ou cadastro fechado) — os testes de vínculo não se aplicam",
  );
} else {
  check(conta.cookie !== null, `a conta "${TEST_ACCOUNT}" está logada (criada agora: ${conta.created})`);

  // 13) quem sou eu, como a conta nova
  const euB = await get("/api/auth/me", cookieB);
  check(
    euB.body?.ok === true && euB.body.account.name === TEST_ACCOUNT,
    "/api/auth/me reconhece a conta recém-criada",
  );
  check(euB.body?.signup === true, "/api/auth/me diz que o cadastro está aberto");
  check(anon.body?.signup === true, "e diz o mesmo para quem não tem conta");

  // 14) a conta nova entra como agente e passa a ter VÍNCULO com a missão
  const bAgente = await joinAs({ cookie: cookieB });
  check(bAgente.ack?.ok === true && bAgente.me?.role === "player", "a conta nova entra como agente");
  await sleep(500); // o vínculo é gravado sem await, junto da partida

  const listaB = await get("/api/campaigns", cookieB);
  const missaoB = listaB.body?.campaigns?.find((c) => c.code === ROOM);
  check(missaoB !== undefined, "a missão entra na lista de quem jogou nela (vínculo)");
  check(missaoB?.role === "player", "e o papel dela ali é agente");
  check(missaoB?.owner === false, "e essa conta não é dona da missão");

  // 15) sem vínculo de mestre e com a chave errada, agente não vira mestre
  const bGm = await joinAs({ cookie: cookieB, key: "nao-e-a-chave" });
  check(bGm.ack?.ok === false, "agente sem vínculo de mestre não vira mestre");
  check(
    /senha/i.test(bGm.ack?.error ?? ""),
    "e a recusa fala da senha, não de um papel que ele não pediu",
  );
  bGm.socket.disconnect();

  // 16) quem não é mestre não dá o papel
  const semPoder = await api(URL, "POST", `/api/campaigns/${ROOM}/role`, {
    body: { name: TEST_ACCOUNT, role: "gm" },
    cookie: cookieB,
  });
  check(semPoder.status === 404, "agente não dá o papel de mestre a ninguém (404)");

  // 17) O MESTRE DÁ O PAPEL — e vale na hora (ADR #22)
  //
  // `bAgente` continua conectado de propósito: o teste do "na hora" é o socket
  // que já estava na mesa receber o papel sem reconectar.
  const promover = await api(URL, "POST", `/api/campaigns/${ROOM}/role`, {
    body: { name: TEST_ACCOUNT, role: "gm" },
    cookie,
  });
  check(promover.status === 200, "o mestre promove um agente a mestre");
  await until(
    () => papelAoVivo(bAgente, TEST_ACCOUNT) === "gm",
    "o papel novo chega ao agente conectado",
  );
  check(true, "e ele vira mestre na sessão aberta, sem F5");

  const listaPromovido = await get("/api/campaigns", cookieB);
  check(
    listaPromovido.body?.campaigns?.find((c) => c.code === ROOM)?.role === "gm",
    "o vínculo gravado é de mestre",
  );

  // O papel não é enfeite: o promovido passa a poder editar o mapa.
  bAgente.state.errors.length = 0;
  bAgente.socket.emit("actor:add", { actor: { name: "Token do promovido", row: 2, col: 2 } });
  await until(
    () => bAgente.state.last?.scene.actors.some((a) => a.name === "Token do promovido"),
    "o promovido mexe no mapa",
  );
  check(bAgente.state.errors.length === 0, "promovido a mestre comanda a mesa na hora");

  // 18) e o mestre tira o papel de volta
  const rebaixar = await api(URL, "POST", `/api/campaigns/${ROOM}/role`, {
    body: { name: TEST_ACCOUNT, role: "player" },
    cookie,
  });
  check(rebaixar.status === 200, "o mestre tira o papel de volta");
  await until(
    () => papelAoVivo(bAgente, TEST_ACCOUNT) === "player",
    "o rebaixamento chega ao agente conectado",
  );
  bAgente.state.errors.length = 0;
  bAgente.socket.emit("map:walls", { op: "set", cells: [{ row: 0, col: 0 }] });
  await until(() => bAgente.state.errors.length > 0, "erro ao editar o mapa depois de rebaixado");
  check(bAgente.state.errors.at(-1)?.code === "DENIED", "rebaixado volta a ser agente na hora");
  bAgente.socket.disconnect();

  // 19) o DONO não é rebaixável: ele administra a missão
  const auto = await api(URL, "POST", `/api/campaigns/${ROOM}/role`, {
    body: { name: USER, role: "player" },
    cookie,
  });
  check(auto.status === 400, "o dono da missão não pode ser rebaixado (400)");

  // 20) quem não é dono não apaga — e o 404 não diz se o selo existe
  const apagar = await api(URL, "DELETE", `/api/campaigns/${ROOM}`, { cookie: cookieB });
  check(apagar.status === 404, "quem não é dono não apaga a missão (404)");

  // 21) entrar na mesa não rebaixa o vínculo de quem já é mestre
  await sleep(500);
  const listaA = await get("/api/campaigns", cookie);
  const missaoA = listaA.body?.campaigns?.find((c) => c.code === ROOM);
  check(missaoA?.role === "gm", "o vínculo do dono continua sendo de mestre");
  check(missaoA?.owner === true, "e ele continua dono da missão");
}

// 22) sair apaga o cookie
const out = await post("/api/auth/logout", {}, cookie);
const setCookie = (out.res.headers.getSetCookie?.() ?? [])[0] ?? "";
check(cookieOf(out.res) === "helio_session=", "o logout manda o cookie vazio");
check(setCookie.includes("Max-Age=0"), "com Max-Age=0, para o navegador esquecer na hora");

// O teste não deixa missão órfã para trás (ADR #18), nem conta (ADR #19).
await missao.cleanup();
deleteTestAccount();

console.log(
  `\n${failures === 0 ? "TUDO OK" : `${failures} FALHA(S)`} — sala ${ROOM}${
    missao.ephemeral ? " (sem banco, selo inventado)" : ""
  }`,
);
process.exit(failures === 0 ? 0 : 1);
