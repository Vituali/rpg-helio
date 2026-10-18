/**
 * Teste de autenticação (entrega 2 do ADR #16).
 *
 * Prova o que o login promete:
 *   - a conta entra com usuário e senha;
 *   - o cookie de sessão identifica a conexão **no handshake** (sem mensagem);
 *   - ser a conta dona da campanha dá o papel de mestre **sem `GM_KEY`**;
 *   - cair e voltar mantém o mesmo papel e o mesmo nome (o fim do "id do
 *     socket como identidade");
 *   - quem não tem conta nem senha não vira mestre.
 *
 *   npm start
 *   SEED_MASTER_USER=helio SEED_MASTER_PASS=123456 npm run auth
 */

import { testCampaign } from "./harness.mjs";

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

// 6) o cookie sozinho já dá o papel de mestre — SEM GM_KEY
const gm = await joinAs("gm", { cookie });
check(gm.ack?.ok === true, "a conta dona da campanha entrou como mestre sem senha");
check(gm.me?.role === "gm", "o papel é mestre");
check(gm.me?.accountId === login.body.account.id, "o jogador carrega o id da conta");
check(gm.me?.name === USER, "o nome veio da conta, não do formulário");

// 7) cair e voltar mantém quem você é — o fim do "id do socket"
gm.socket.disconnect();
await sleep(400);
const voltou = await joinAs("gm", { cookie, name: "Outro Nome Digitado" });
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

// 10) sair apaga o cookie
const out = await post("/api/auth/logout", {}, cookie);
const setCookie = (out.res.headers.getSetCookie?.() ?? [])[0] ?? "";
check(cookieOf(out.res) === "helio_session=", "o logout manda o cookie vazio");
check(setCookie.includes("Max-Age=0"), "com Max-Age=0, para o navegador esquecer na hora");

// O teste não deixa missão órfã para trás (ADR #18).
await missao.cleanup();

console.log(
  `\n${failures === 0 ? "TUDO OK" : `${failures} FALHA(S)`} — sala ${ROOM}${
    missao.ephemeral ? " (sem banco, selo inventado)" : ""
  }`,
);
process.exit(failures === 0 ? 0 : 1);
