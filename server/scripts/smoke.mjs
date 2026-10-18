/**
 * Teste de fumaça do servidor (Fase 2).
 *
 * Simula um mestre e um jogador reais e verifica as regras que só o servidor
 * decide: permissão de movimento, colisão com parede, e sincronia entre os dois.
 *
 *   npm start        (noutro terminal)
 *   npm run smoke
 */

import { io } from "socket.io-client";

const URL = process.env.URL ?? "http://localhost:3100";
const ROOM = `SMOKE-${Math.floor(Math.random() * 1e6)}`;
/** Precisa ser igual ao GM_KEY do servidor que está sendo testado. */
const GM_KEY = process.env.GM_KEY ?? "";

let failures = 0;
function check(ok, label) {
  console.log(`${ok ? "  ok  " : " FALHA"}  ${label}`);
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

function makeClient(name) {
  const socket = io(URL, { transports: ["websocket"] });
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

const join = (c, role, key = "") =>
  new Promise((resolve) => {
    c.socket.emit("room:join", { code: ROOM, name: c.name, role, key }, (state) => {
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
const gm = makeClient("Mestre");
const jogador = makeClient("Jogador");
const intruso = makeClient("Intruso");

await joined(gm);
await joined(jogador);
await joined(intruso);

// Senha de mestre: com GM_KEY definida no servidor, senha errada não entra.
if (GM_KEY) {
  const errada = await join(intruso, "gm", "senha-errada");
  check(errada?.ok === false, "senha de mestre errada é recusada");
  const vazia = await join(intruso, "gm", "");
  check(vazia?.ok === false, "sem senha nenhuma também é recusada");
} else {
  console.log("  --    GM_KEY vazia neste servidor: pulando os testes de senha");
}
intruso.socket.disconnect();

await join(gm, "gm", GM_KEY);
const jogState = await join(jogador, "player");

check(me(gm)?.role === "gm", "mestre entrou (com a senha)");
check(jogState?.ok === true, "jogador entra sem senha");
check(jogState.scene.actors.length === 1, "jogador recebeu um token próprio");

const playerId = jogador.last.you;
const myActor = jogador.last.scene.actors.find((a) => a.ownerId === playerId);
check(!!myActor, "o token do jogador aponta para ele");
check(myActor?.canMove === false, "começa SEM permissão de andar");

await until(
  () => gm.last?.scene.version > 0 && gm.last.scene.actors.length === 1,
  "o mestre vê o token do jogador",
);

// 1) sem permissão → negado
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

// 2) o mestre libera → anda
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

// 3) parede bloqueia
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

// 4) o jogador não pode editar o mapa
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

// 5) fog descoberto é compartilhado
const alvo = { row: agora.row, col: agora.col + 1 };
jogador.socket.emit("fog:discover", { cells: [alvo] });
await until(
  () => gm.last.scene.fogExplored[alvo.row][alvo.col] === 1,
  "a célula explorada chega ao mestre",
);
check(true, "fog explorado pelo jogador é compartilhado");

// 6) sair limpa o dono do token
jogador.socket.disconnect();
await until(
  () =>
    gm.last.scene.actors.find((a) => a.id === myActor.id)?.ownerId === null,
  "o token fica sem dono quando o jogador sai",
);
check(true, "ao sair, o token volta para as mãos do mestre");

gm.socket.disconnect();
console.log(
  `\n${failures === 0 ? "TUDO OK" : `${failures} FALHA(S)`} — sala ${ROOM}`,
);
process.exit(failures === 0 ? 0 : 1);
