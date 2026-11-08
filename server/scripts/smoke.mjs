/**
 * Teste de fumaça do servidor (Fase 2 + ADR #20).
 *
 * Simula um mestre e um jogador reais e verifica as regras que só o servidor
 * decide: entrada com conta, permissão de movimento, colisão com parede, e
 * sincronia entre os dois.
 *
 *   npm start        (noutro terminal)
 *   SEED_MASTER_USER=helio SEED_MASTER_PASS=123456 npm run smoke
 */

import { io } from "socket.io-client";
import { deleteTestAccount, masterCookie, testAccount, testCampaign } from "./harness.mjs";

const URL = process.env.URL ?? "http://localhost:3100";
/** Precisa ser igual ao GM_KEY do servidor que está sendo testado. */
const GM_KEY = process.env.GM_KEY ?? "";

// O selo da sala de teste: criado aqui e apagado no fim (ADR #18).
const missao = await testCampaign(URL, "SMOKE");
const ROOM = missao.code;

// A conta é a porta (ADR #20): o teste entra logado dos dois lados. O mestre é a
// conta-semente — dona da missão criada acima, portanto com vínculo de mestre;
// o jogador é a conta descartável dos testes.
const cookieMestre = await masterCookie(URL);
const conta = await testAccount(URL);
if (!cookieMestre || !conta.cookie) {
  console.error(
    "o smoke precisa de contas: sem login (SESSION_SECRET e conta-semente) ninguém entra na mesa",
  );
  await missao.cleanup();
  process.exit(1);
}

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

function makeClient(name, cookie) {
  const socket = io(URL, {
    transports: ["websocket"],
    // O cookie de sessão vai no handshake: não existe mensagem de login.
    extraHeaders: cookie ? { Cookie: cookie } : {},
  });
  const client = { socket, name, last: null, errors: [] };
  socket.on("room:state", (st) => {
    client.last = st;
  });
  socket.on("error", (e) => {
    client.errors.push(e);
  });
  return client;
}

const joined = (c) =>
  new Promise((resolve, reject) => {
    if (c.socket.connected) return resolve();
    c.socket.once("connect", resolve);
    c.socket.once("connect_error", reject);
  });

// O cliente não manda nome nem papel: o servidor decide os dois (ADR #20).
const join = (c, key = "") =>
  new Promise((resolve) => {
    c.socket.emit("room:join", { code: ROOM, key }, (state) => {
      // O ack chega antes do primeiro broadcast; usa ele como estado inicial.
      if (state?.ok) c.last = state;
      resolve(state);
    });
  });

const me = (c) => c.last?.players.find((p) => p.id === c.last.you);
const actorOf = (c, id) => c.last?.scene.actors.find((a) => a.id === id);
const cellOf = (c, id) => {
  const a = actorOf(c, id);
  return a ? `${a.row},${a.col}` : "?";
};

// ── Roteiro ──────────────────────────────────────────────────────────────────
const gm = makeClient("Mestre", cookieMestre);
const jogador = makeClient("Jogador", conta.cookie);
const visita = makeClient("Sem conta", null);

await joined(gm);
await joined(jogador);
await joined(visita);

// 0) sem conta, a mesa não abre (ADR #20)
const semConta = await join(visita);
check(semConta?.ok === false, "sem conta não se entra na mesa");
check(/conta/i.test(semConta?.error ?? ""), "e a recusa fala em conta");
visita.socket.disconnect();

// 1) a chave de mestre: errada é recusada; sem GM_KEY, nenhuma promove
if (GM_KEY) {
  const errada = await join(jogador, "senha-errada");
  check(errada?.ok === false, "senha de mestre errada é recusada");
} else {
  console.log("  --    GM_KEY vazia neste servidor: a chave não promove ninguém");
  const qualquer = await join(jogador, "qualquer-chave");
  check(qualquer?.ok === false, "chave inventada não promove");
}

// 2) o vínculo abre a mesa como mestre, sem chave nenhuma
await join(gm);
check(me(gm)?.role === "gm", "quem criou a missão entra como mestre (vínculo)");

// 3) e o agente entra como agente
const jogState = await join(jogador);
check(jogState?.ok === true, "o agente entra com a própria conta");
check(me(jogador)?.role === "player", "e o papel dele é agente");
check(jogState.scene.actors.length === 1, "jogador recebeu um token próprio");

const playerId = jogador.last.you;
const myActor = jogador.last.scene.actors.find((a) => a.ownerId === playerId);
check(!!myActor, "o token do jogador aponta para ele");
check(myActor?.canMove === false, "começa SEM permissão de andar");

await until(
  () => gm.last?.scene.version > 0 && gm.last.scene.actors.length === 1,
  "o mestre vê o token do jogador",
);

// 4) sem permissão → negado
jogador.errors.length = 0;
jogador.socket.emit("actor:intent-move", {
  actorId: myActor.id,
  row: myActor.row + 1,
  col: myActor.col,
});
await until(() => jogador.errors.length > 0, "erro de movimento negado");
check(
  jogador.errors.at(-1)?.code === "MOVE_DENIED",
  "movimento sem permissão é recusado pelo servidor",
);
check(
  cellOf(jogador, myActor.id) === `${myActor.row},${myActor.col}`,
  "o token não saiu do lugar",
);

// 5) o mestre libera → anda
gm.socket.emit("perm:set", { playerId, canMoveGlobal: true });
await until(
  () => me(jogador)?.canMoveGlobal === true,
  "o jogador recebe a liberação",
);

const from = `${myActor.row},${myActor.col}`;
jogador.errors.length = 0;
jogador.socket.emit("actor:intent-move", {
  actorId: myActor.id,
  row: myActor.row + 1,
  col: myActor.col,
});
await until(() => cellOf(jogador, myActor.id) !== from, "o token andou");
check(jogador.errors.length === 0, "movimento liberado é aceito");
check(
  cellOf(gm, myActor.id) === cellOf(jogador, myActor.id),
  `mestre e jogador concordam na posição (${cellOf(gm, myActor.id)})`,
);

// 5b) F5 no meio da partida: a permissão é da conta, não do socket
jogador.socket.disconnect();
await until(
  () => gm.last?.players.every((p) => p.role === "gm"),
  "o mestre vê o agente sair",
);
jogador.socket.connect();
await joined(jogador);
const rejoin = await join(jogador);
check(rejoin?.ok === true, "o agente reconecta depois do F5");
check(
  me(jogador)?.canMoveGlobal === true,
  "a liberação de movimento sobrevive à reconexão",
);
check(
  jogador.last.scene.actors.length === 1,
  "a reconexão não duplica o token",
);
check(
  jogador.last.scene.actors[0]?.ownerId === jogador.last.you,
  "o token reencontra o dono depois do F5",
);
const depoisDoF5 = actorOf(jogador, myActor.id);
const antesDoPasso = cellOf(jogador, myActor.id);
jogador.errors.length = 0;
jogador.socket.emit("actor:intent-move", {
  actorId: myActor.id,
  row: depoisDoF5.row + 1,
  col: depoisDoF5.col,
});
await until(
  () => cellOf(jogador, myActor.id) !== antesDoPasso,
  "o token anda depois do F5",
);
check(
  jogador.errors.length === 0,
  "movimento continua liberado depois da reconexão",
);

// 6) parede bloqueia
const agora = actorOf(jogador, myActor.id);
gm.socket.emit("map:walls", {
  op: "set",
  cells: [{ row: agora.row + 1, col: agora.col }],
});
await until(
  () => gm.last.scene.walls[agora.row + 1][agora.col] === true,
  "a parede aparece para o mestre",
);
await until(
  () => jogador.last.scene.walls[agora.row + 1][agora.col] === true,
  "a parede chega ao jogador",
);

jogador.errors.length = 0;
jogador.socket.emit("actor:intent-move", {
  actorId: myActor.id,
  row: agora.row + 1,
  col: agora.col,
});
await until(() => jogador.errors.length > 0, "erro de parede");
check(
  jogador.errors.at(-1)?.msg === "Parede.",
  "andar para dentro de uma parede é recusado",
);

// 7) o jogador não pode editar o mapa
jogador.errors.length = 0;
jogador.socket.emit("map:walls", {
  op: "set",
  cells: [{ row: 0, col: 0 }],
});
await until(() => jogador.errors.length > 0, "erro de permissão de mestre");
check(
  jogador.errors.at(-1)?.code === "DENIED",
  "jogador não consegue editar o mapa",
);

// 8) fog descoberto é compartilhado
const alvo = { row: agora.row, col: agora.col + 1 };
jogador.socket.emit("fog:discover", { cells: [alvo] });
await until(
  () => gm.last.scene.fogExplored[alvo.row][alvo.col] === 1,
  "a célula explorada chega ao mestre",
);
check(true, "fog explorado pelo jogador é compartilhado");

// 9) o servidor é dono da verdade do fog: célula longe da visão é recusada
const longe = { row: 0, col: jogador.last.scene.cols - 1 };
jogador.socket.emit("fog:discover", { cells: [longe] });
await sleep(500);
check(
  gm.last.scene.fogExplored[longe.row][longe.col] === 0,
  "fog fora da visão de qualquer ator é recusado",
);

// 9b) Fase 3: o teto do jogador são os TOKENS DELE, não a união de todos.
// Um NPC do mestre longe do jogador enxerga uma célula que o jogador não pode
// descobrir — e o mestre continua podendo, porque a visão dele é a cena toda.
const npcCell = { row: jogador.last.scene.rows - 1, col: jogador.last.scene.cols - 2 };
gm.socket.emit("actor:add", {
  actor: {
    name: "NPC Fog",
    row: npcCell.row,
    col: npcCell.col + 1,
    vision: 2,
  },
});
await until(
  () => gm.last.scene.actors.some((a) => a.name === "NPC Fog"),
  "o NPC do mestre aparece",
);
jogador.socket.emit("fog:discover", { cells: [npcCell] });
await sleep(400);
check(
  gm.last.scene.fogExplored[npcCell.row][npcCell.col] === 0,
  "jogador não descobre o raio de visão de um NPC do mestre",
);
gm.socket.emit("fog:discover", { cells: [npcCell] });
await until(
  () => gm.last.scene.fogExplored[npcCell.row][npcCell.col] === 1,
  "o mestre revela a célula vista pelo NPC",
);
check(true, "o mestre continua dono da cena inteira");

// o ataque que existia antes: mandar o tabuleiro inteiro numa mensagem e
// apagar o fog de guerra de todo mundo de uma vez.
const tudo = [];
for (let r = 0; r < jogador.last.scene.rows; r += 1) {
  for (let c = 0; c < jogador.last.scene.cols; c += 1) {
    tudo.push({ row: r, col: c });
  }
}
jogador.socket.emit("fog:discover", { cells: tudo });
await sleep(500);
const total = jogador.last.scene.rows * jogador.last.scene.cols;
const vistas = gm.last.scene.fogExplored.flat().filter((v) => v === 1).length;
check(
  vistas <= 100,
  `tabuleiro inteiro numa mensagem não revela o mapa (${vistas} de ${total})`,
);

// 10) limite de taxa: a rajada estoura o balde e o pacote é descartado
const inerte = { row: alvo.row, col: alvo.col }; // já explorada: flood não muda estado
const parado = cellOf(jogador, myActor.id);
jogador.errors.length = 0;
for (let i = 0; i < 500; i += 1) {
  jogador.socket.emit("fog:discover", { cells: [inerte] });
}
// sem pausa de propósito: os tokens acabaram, então isto tem que ser barrado
jogador.socket.emit("actor:intent-move", {
  actorId: myActor.id,
  row: agora.row,
  col: agora.col + 1,
});
await sleep(600);
check(
  cellOf(jogador, myActor.id) === parado && jogador.errors.length === 0,
  "rajada acima do limite é descartada em silêncio",
);

// 11) e o limite não trava o jogador para sempre: o balde reenche
await sleep(3000);
jogador.socket.emit("actor:intent-move", {
  actorId: myActor.id,
  row: agora.row,
  col: agora.col + 1,
});
await until(
  () => cellOf(jogador, myActor.id) === `${agora.row},${agora.col + 1}`,
  "o movimento volta a funcionar depois da rajada",
);
check(true, "o limite de taxa não trava o jogador para sempre");

// 12) sair limpa o dono do token
jogador.socket.disconnect();
await until(
  () =>
    gm.last.scene.actors.find((a) => a.id === myActor.id)?.ownerId === null,
  "o token fica sem dono quando o jogador sai",
);
check(true, "ao sair, o token volta para as mãos do mestre");

gm.socket.disconnect();

// O teste não deixa missão órfã para trás (ADR #18), nem conta de teste. Com o
// cadastro fechado, a conta é **fixture**: sem ela a próxima execução não teria
// como criar uma.
await missao.cleanup();
const eu = await fetch(`${URL}/api/auth/me`)
  .then((r) => r.json())
  .catch(() => null);
if (eu?.signup === true) deleteTestAccount();

console.log(
  `\n${failures === 0 ? "TUDO OK" : `${failures} FALHA(S)`} — sala ${ROOM}${
    missao.ephemeral ? " (sem banco, selo inventado)" : ""
  }`,
);
process.exit(failures === 0 ? 0 : 1);
