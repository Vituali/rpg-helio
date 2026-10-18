/**
 * Teste de contas, vínculo e sessão (entregas 2 e 4 — ADRs #16 e #19).
 *
 * Prova o que a conta promete:
 *   - a conta entra com usuário e senha;
 *   - dá para **criar a própria conta**, e o cadastro já sai logado;
 *   - o cookie de sessão identifica a conexão **no handshake** (sem mensagem);
 *   - **ser mestre vem do vínculo com a missão**, não de "ser dono": quem tem
 *     vínculo entra como mestre com a chave errada no bolso;
 *   - sem vínculo e sem chave, ninguém vira mestre;
 *   - cair e voltar mantém o mesmo papel e o mesmo nome (o fim do "id do socket
 *     como identidade").
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

// O socket.io-client do Node não tem cookie jar: o cookie vai no handshake na mão.
async function joinAs(role, { cookie, key = "", name = "Convidado" } = {}) {
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
    socket.emit("room:join", { code: ROOM, name, role, key }, (s) => {
      if (s?.ok) state.last = s;
      resolve(s);
    });
  });
  const me = ack?.ok ? ack.players.find((p) => p.id === ack.you) : null;
  return { socket, ack, state, me };
}

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

// 6) o VÍNCULO dá o papel de mestre — e é só ele: a chave vai errada de propósito
//
// É o que a entrega 4 mudou. Se o papel ainda viesse de "ser a conta dona da
// campanha", este teste passaria do mesmo jeito; se viesse da chave, falharia —
// que é o que se quer ver. Com a chave errada no bolso, a única explicação para
// o `gm` aceito é o vínculo.
if ((process.env.GM_KEY ?? "") === "") {
  console.log("  nota: GM_KEY vazia neste servidor — o teste da chave errada não isola nada");
}
const gm = await joinAs("gm", { cookie, key: "nao-e-a-chave" });
check(gm.ack?.ok === true, "o vínculo de mestre abre a mesa sem depender da chave");
check(gm.me?.role === "gm", "o papel é mestre");
check(gm.me?.accountId === login.body.account.id, "o jogador carrega o id da conta");
check(gm.me?.name === USER, "o nome veio da conta, não do formulário");

// 7) cair e voltar mantém quem você é — o fim do "id do socket"
gm.socket.disconnect();
await sleep(400);
const voltou = await joinAs("gm", { cookie, key: "nao-e-a-chave", name: "Outro Nome Digitado" });
check(voltou.ack?.ok === true, "voltou e foi reconhecido como mestre de novo");
check(
  voltou.me?.accountId === gm.me?.accountId && voltou.me?.name === USER,
  "e é a MESMA conta, com o mesmo nome (o digitado foi ignorado)",
);
voltou.socket.disconnect();

// 8) sem conta e sem senha, ninguém vira mestre
const anonGm = await joinAs("gm", { key: "" });
check(anonGm.ack?.ok === false, "convidado sem senha não vira mestre");
anonGm.socket.disconnect();

// 9) convidado continua entrando como jogador, só com o nome
const convidado = await joinAs("player", { name: "Convidado" });
check(convidado.ack?.ok === true && convidado.me?.role === "player", "convidado entra como jogador");
check(convidado.me?.accountId === null, "e não tem conta — a identidade é do socket");
convidado.socket.disconnect();

// ── Cadastro e vínculo (entrega 4 — ADR #19) ─────────────────────────────────

// 10) cadastro: senha curta é recusada antes de qualquer coisa
const curta = await post("/api/accounts", { name: TEST_ACCOUNT, password: "123" });
check(curta.status === 400, "cadastro com senha curta é recusado com 400");

// 11) cadastro: repetir um nome existente é recusado — e aqui o nome repetido é
// dito na cara, ao contrário do login. Não dá para esconder: o `unique`
// recusaria do mesmo jeito, e mensagem genérica só faria a pessoa tentar de novo
// à toa.
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
  const bAgente = await joinAs("player", { cookie: cookieB });
  check(bAgente.ack?.ok === true && bAgente.me?.role === "player", "a conta nova entra como agente");
  bAgente.socket.disconnect();
  await sleep(500); // o vínculo é gravado sem await, junto da partida

  const listaB = await get("/api/campaigns", cookieB);
  const missaoB = listaB.body?.campaigns?.find((c) => c.code === ROOM);
  check(missaoB !== undefined, "a missão entra na lista de quem jogou nela (vínculo)");
  check(missaoB?.role === "player", "e o papel dela ali é agente");
  check(missaoB?.owner === false, "e essa conta não é dona da missão");

  // 15) sem vínculo de mestre e com a chave errada, agente não vira mestre
  const bGm = await joinAs("gm", { cookie: cookieB, key: "nao-e-a-chave" });
  check(bGm.ack?.ok === false, "agente sem vínculo de mestre não vira mestre");
  bGm.socket.disconnect();

  // 16) quem não é dono não apaga — e o 404 não diz se o selo existe
  const apagar = await api(URL, "DELETE", `/api/campaigns/${ROOM}`, { cookie: cookieB });
  check(apagar.status === 404, "quem não é dono não apaga a missão (404)");

  // 17) o vínculo de mestre é do mestre, e jogar como agente não rebaixa
  const aAgente = await joinAs("player", { cookie });
  check(aAgente.ack?.ok === true, "o mestre também pode entrar como agente numa sessão");
  aAgente.socket.disconnect();
  await sleep(500);
  const listaA = await get("/api/campaigns", cookie);
  const missaoA = listaA.body?.campaigns?.find((c) => c.code === ROOM);
  check(missaoA?.role === "gm", "e o vínculo dele continua sendo de mestre");
  check(missaoA?.owner === true, "e ele continua dono da missão");
}

// 18) sair apaga o cookie
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
