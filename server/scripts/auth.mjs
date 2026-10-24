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
 *   - **só a conta de administração** lista contas e troca senha (ADR #23), e ela
 *     pode **delegar** a administração, valendo na hora (ADR #24);
 *   - **cadastro e sala da casa são configuração viva** (ADR #25): o painel muda
 *     e o servidor obedece sem restart, sem tocar no `.env`;
 *   - cair e voltar mantém o mesmo papel e o mesmo nome.
 *
 *   npm start
 *   SEED_MASTER_USER=helio SEED_MASTER_PASS=123456 npm run auth
 */

import {
  TEST_ACCOUNT,
  TEST_ACCOUNT_PASS,
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

// A configuração pública (ADR #25) responde antes do login: é dela que a tela de
// entrada tira o "posso criar conta?" e o lobby, a sala da casa.
const publico = await get("/api/settings");
check(
  publico.status === 200 &&
    typeof publico.body?.defaultRoom === "string" &&
    typeof publico.body?.signup === "boolean",
  "o servidor publica cadastro e sala da casa sem exigir sessão",
);

/**
 * O servidor aceita cadastro novo? (ADR #19)
 *
 * Com `REGISTRATION=closed`, metade desta suíte não se aplica: não há cadastro
 * para testar, e a conta descartável precisa já existir. O teste continua útil
 * para login, papel e painel — só não inventa conta.
 */
const cadastroAberto = anon.body?.signup === true;

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
if (cadastroAberto) {
  const curta = await post("/api/accounts", { name: TEST_ACCOUNT, password: "123" });
  check(curta.status === 400, "cadastro com senha curta é recusado com 400");

  // 11) cadastro: repetir um nome existente é recusado — e aqui o nome repetido é
  // dito na cara, ao contrário do login.
  const repetido = await post("/api/accounts", { name: USER, password: "qualquer-senha" });
  check(repetido.status === 409, "cadastro com nome já tomado é recusado com 409");
} else {
  const fechado = await post("/api/accounts", {
    name: "cadastro-fechado-teste",
    password: "123456",
  });
  check(fechado.status === 403, "com o cadastro fechado, criar conta é recusado (403)");
}

// 12) cadastro de verdade: cria, já sai logada, e o nome sai do banco
const conta = await testAccount(URL);
const cookieB = conta.cookie ?? "";

if (cookieB === "") {
  console.log(
    "  nota: cadastro fechado e a conta de teste não existe — crie \"agente-teste\" com REGISTRATION=open",
  );
  console.log("        para rodar os testes de vínculo; os de login, papel e painel seguem valendo");
} else {
  check(conta.cookie !== null, `a conta "${TEST_ACCOUNT}" está logada (criada agora: ${conta.created})`);

  // 13) quem sou eu, como a conta nova
  const euB = await get("/api/auth/me", cookieB);
  check(
    euB.body?.ok === true && euB.body.account.name === TEST_ACCOUNT,
    "/api/auth/me reconhece a conta recém-criada",
  );
  if (cadastroAberto) {
    check(euB.body?.signup === true, "/api/auth/me diz que o cadastro está aberto");
    check(anon.body?.signup === true, "e diz o mesmo para quem não tem conta");
  } else {
    check(
      euB.body?.signup === false && anon.body?.signup === false,
      "com o cadastro fechado, com e sem conta, o servidor avisa que não aceita nova",
    );
  }

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

// 22) painel do administrador (ADRs #23 e #24)
//
// As recusas precisam de uma conta que **não seja administradora**. O mestre pode
// ser (delegado, e nesta máquina é); o agente de teste normalmente não é. O alvo
// é escolhido, não presumido. O caminho de sucesso só roda se
// `ADMIN_NAME`/`ADMIN_PASS` vierem do ambiente — a senha do administrador real
// não é assunto do teste.
const mestreAdmin = (await get("/api/auth/me", cookie)).body?.account?.admin === true;
const agenteAdmin =
  cookieB === "" ? true : (await get("/api/auth/me", cookieB)).body?.account?.admin === true;
const comum = !mestreAdmin ? cookie : !agenteAdmin ? cookieB : "";

if (comum !== "") {
  const semPoderLista = await get("/api/admin/accounts", comum);
  check(semPoderLista.status === 403, "quem não é administrador não lista contas (403)");

  const semPoderSenha = await post(
    `/api/admin/accounts/${encodeURIComponent(TEST_ACCOUNT)}/password`,
    { password: "senha-do-invasor" },
    comum,
  );
  check(semPoderSenha.status === 403, "nem troca a senha de ninguém (403)");

  const semPoderAdmin = await post(
    `/api/admin/accounts/${encodeURIComponent(TEST_ACCOUNT)}/admin`,
    { admin: true },
    comum,
  );
  check(semPoderAdmin.status === 403, "nem delega administração (403)");

  const semPoderConfig = await get("/api/admin/settings", comum);
  check(semPoderConfig.status === 403, "nem lê a configuração do servidor (403)");

  const semPoderMudar = await post(
    "/api/admin/settings",
    { registration: true },
    comum,
  );
  check(semPoderMudar.status === 403, "nem abre o cadastro (403)");
} else {
  console.log("  nota: todas as contas de teste são administradoras — as recusas ficaram de fora");
}

check((await get("/api/admin/accounts")).status === 401, "sem sessão, o painel não abre (401)");

const ADMIN_NAME = process.env.ADMIN_NAME ?? "admin";
const ADMIN_PASS = process.env.ADMIN_PASS ?? "";
if (ADMIN_PASS && cookieB !== "") {
  const adminLogin = await post("/api/auth/login", { name: ADMIN_NAME, password: ADMIN_PASS });
  check(adminLogin.status === 200, `a conta de administração "${ADMIN_NAME}" entrou`);
  check(
    adminLogin.body?.account?.admin === true,
    "e o servidor a reconhece como administradora",
  );
  const adminCookie = cookieOf(adminLogin.res);

  const lista = await get("/api/admin/accounts", adminCookie);
  const contas = lista.body?.accounts ?? [];
  const nomes = contas.map((a) => a.name);
  check(lista.status === 200 && Array.isArray(lista.body?.accounts), "o administrador lista as contas");
  check(nomes.includes(TEST_ACCOUNT), "a conta de teste aparece na lista");
  check(nomes.includes(ADMIN_NAME), "e a dele também");

  const linha = contas.find((a) => a.name === TEST_ACCOUNT);
  check(
    typeof linha?.createdAt === "string" && !Number.isNaN(Date.parse(linha.createdAt)),
    "cada conta traz a data de criação",
  );

  const nova = "senha-trocada-987654";
  const trocada = await post(
    `/api/admin/accounts/${encodeURIComponent(TEST_ACCOUNT)}/password`,
    { password: nova },
    adminCookie,
  );
  check(trocada.status === 200, "o administrador troca a senha de uma conta");

  const comAntiga = await post("/api/auth/login", {
    name: TEST_ACCOUNT,
    password: TEST_ACCOUNT_PASS,
  });
  check(comAntiga.status === 401, "a senha antiga não entra mais");

  const comNova = await post("/api/auth/login", { name: TEST_ACCOUNT, password: nova });
  check(comNova.status === 200, "a senha nova entra");

  const curta = await post(
    `/api/admin/accounts/${encodeURIComponent(TEST_ACCOUNT)}/password`,
    { password: "123" },
    adminCookie,
  );
  check(curta.status === 400, "senha curta é recusada (400)");

  const fantasma = await post(
    "/api/admin/accounts/ninguem-aqui/password",
    { password: nova },
    adminCookie,
  );
  check(fantasma.status === 404, "conta que não existe dá 404");

  // 22b) delegar a administração (ADR #24)
  //
  // A lista carrega o último acesso: é o que permite saber de quem é a conta.
  check(
    typeof linha?.lastLoginAt === "string" && !Number.isNaN(Date.parse(linha.lastLoginAt)),
    "a lista diz quando a conta entrou pela última vez",
  );

  const rebaixarRaiz = await post(
    // A raiz é a que o **servidor** diz que é (`ADMIN_ACCOUNT`), não necessariamente
    // a conta com que o teste entrou: quem entrou pode ser um administrador
    // delegado, e rebaixar esse seria mexer na configuração do dono do servidor.
    `/api/admin/accounts/${encodeURIComponent(String(lista.body?.admin ?? ADMIN_NAME))}/admin`,
    { admin: false },
    adminCookie,
  );
  check(rebaixarRaiz.status === 400, "a conta raiz não pode ser rebaixada (400)");

  const semResposta = await post(
    `/api/admin/accounts/${encodeURIComponent(TEST_ACCOUNT)}/admin`,
    {},
    adminCookie,
  );
  check(semResposta.status === 400, "sem dizer dá ou tira, a rota recusa (400)");

  if (!agenteAdmin) {
    // O alvo da delegação é a conta descartável, nunca a conta pessoal do mestre:
    // o teste não pode mexer no que o dono do servidor decidiu na tela.
    const dar = await post(
      `/api/admin/accounts/${encodeURIComponent(TEST_ACCOUNT)}/admin`,
      { admin: true },
      adminCookie,
    );
    check(dar.status === 200, "o administrador delega a administração");

    const euAgora = await get("/api/auth/me", cookieB);
    check(euAgora.body?.account?.admin === true, "e vale na hora, sem novo login");
    check(
      (await get("/api/admin/accounts", cookieB)).status === 200,
      "quem recebeu entra no painel na hora",
    );

    const listaDepois = await get("/api/admin/accounts", adminCookie);
    const delegado = (listaDepois.body?.accounts ?? []).find((a) => a.name === TEST_ACCOUNT);
    check(delegado?.isAdmin === true, "e a lista marca a conta como administradora");

    const tirar = await post(
      `/api/admin/accounts/${encodeURIComponent(TEST_ACCOUNT)}/admin`,
      { admin: false },
      adminCookie,
    );
    check(tirar.status === 200, "e tira de volta");
    const euDeNovo = await get("/api/auth/me", cookieB);
    check(euDeNovo.body?.account?.admin === false, "quem perdeu vê o painel fechar na hora");
    check(
      (await get("/api/admin/accounts", cookieB)).status === 403,
      "e volta a receber 403",
    );
  } else {
    console.log("  nota: a conta de teste é a raiz; a delegação ficou de fora");
  }

  // 22c) configuração viva — cadastro e sala da casa (ADR #25)
  //
  // O teste mexe e **devolve** o que estava: a configuração é do servidor, não da
  // suíte. Nada aqui cria conta, então rodar com o cadastro fechado é seguro.
  const cfg0 = await get("/api/admin/settings", adminCookie);
  check(
    cfg0.status === 200 &&
      (cfg0.body?.settings?.registration === "open" ||
        cfg0.body?.settings?.registration === "closed") &&
      typeof cfg0.body?.settings?.defaultRoom === "string",
    "o administrador lê a configuração viva",
  );
  const registroOriginal = cfg0.body?.settings?.registration === "closed" ? "closed" : "open";
  const salaOriginal = String(cfg0.body?.settings?.defaultRoom ?? "");

  const abriu = await post("/api/admin/settings", { registration: true }, adminCookie);
  check(
    abriu.status === 200 && abriu.body?.settings?.registration === "open",
    "o painel abre o cadastro",
  );
  check(
    (await get("/api/auth/me")).body?.signup === true,
    "e o servidor passa a aceitar conta nova na hora, sem novo login",
  );

  const fechou = await post("/api/admin/settings", { registration: false }, adminCookie);
  check(
    fechou.status === 200 && fechou.body?.settings?.registration === "closed",
    "e fecha de novo",
  );
  check((await get("/api/auth/me")).body?.signup === false, "a tela de entrada vê o fechamento");

  const salaFantasma = await post(
    "/api/admin/settings",
    { defaultRoom: "NAO-EXISTE-ESSA-SALA-00" },
    adminCookie,
  );
  check(salaFantasma.status === 404, "sala da casa com selo inexistente é recusada (404)");

  const sala = await post("/api/admin/settings", { defaultRoom: ROOM }, adminCookie);
  check(
    sala.status === 200 && sala.body?.settings?.defaultRoom === ROOM,
    "o painel aponta a sala da casa para uma missão que existe",
  );
  check(
    (await get("/api/settings")).body?.defaultRoom === ROOM,
    "e o lobby recebe a sala da casa sem estar logado",
  );

  const restaurar = await post(
    "/api/admin/settings",
    { registration: registroOriginal === "open", defaultRoom: salaOriginal },
    adminCookie,
  );
  check(restaurar.status === 200, "a configuração original volta no fim");

  // Devolve a senha original: a próxima execução entra com ela.
  const volta = await post(
    `/api/admin/accounts/${encodeURIComponent(TEST_ACCOUNT)}/password`,
    { password: TEST_ACCOUNT_PASS },
    adminCookie,
  );
  check(volta.status === 200, "e a senha original volta no fim");
} else {
  console.log("  nota: ADMIN_PASS não veio; o caminho do administrador ficou de fora");
}

// 23) sair apaga o cookie
const out = await post("/api/auth/logout", {}, cookie);
const setCookie = (out.res.headers.getSetCookie?.() ?? [])[0] ?? "";
check(cookieOf(out.res) === "helio_session=", "o logout manda o cookie vazio");
check(setCookie.includes("Max-Age=0"), "com Max-Age=0, para o navegador esquecer na hora");

// O teste não deixa missão órfã para trás (ADR #18), nem conta (ADR #19).
// Com o cadastro fechado, a conta de teste é **fixture**: sem ela, a próxima
// execução não teria como criar uma, e os testes de vínculo sumiriam.
await missao.cleanup();
if (cadastroAberto) {
  deleteTestAccount();
} else {
  console.log("  nota: cadastro fechado — a conta de teste fica para a próxima execução");
}

console.log(
  `\n${failures === 0 ? "TUDO OK" : `${failures} FALHA(S)`} — sala ${ROOM}${
    missao.ephemeral ? " (sem banco, selo inventado)" : ""
  }`,
);
process.exit(failures === 0 ? 0 : 1);
