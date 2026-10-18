/**
 * Teste de persistência (passo 1 do ADR #17).
 *
 * Prova a única coisa que a persistência promete: **a mesa não se perde**.
 * O script tem duas fases, para poder atravessar um restart do container — que
 * é justamente o cenário que motivou tudo:
 *
 *   # 1. escreve uma cena marcada e sai (o servidor grava no banco)
 *   PHASE=write CODE=TESTE node scripts/persist.mjs
 *
 *   # 2. reinicia o container — a sala sai da memória
 *   docker compose restart app
 *
 *   # 3. volta e confere que a cena é a mesma
 *   PHASE=check CODE=TESTE node scripts/persist.mjs
 *
 * Sem `CODE`, sorteia um. A cena é sempre a mesma marca, derivada do código,
 * então as duas fases não precisam combinar nada por fora.
 */

import { io } from "socket.io-client";

const URL = process.env.URL ?? "http://localhost";
const CODE = (process.env.CODE ?? `PERSIST-${Math.floor(Math.random() * 1e6)}`).toUpperCase();
const GM_KEY = process.env.GM_KEY ?? "";
const PHASE = process.env.PHASE ?? "write";

let failures = 0;
function check(ok, label) {
  console.log(`${ok ? "  ok  " : "  FALHA"}  ${label}`);
  if (!ok) failures += 1;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, label, tries = 100) {
  for (let i = 0; i < tries; i += 1) {
    if (fn()) return true;
    await sleep(50);
  }
  throw new Error(`timeout esperando: ${label}`);
}

/** As marcas, derivadas do código: as duas fases chegam nelas sozinhas. */
function marks(code) {
  let n = 0;
  for (const ch of code) n = (n * 31 + ch.charCodeAt(0)) % 997;
  const r = 2 + (n % 8);
  const c = 2 + (n % 10);
  return {
    walls: [
      { row: r, col: c },
      { row: r, col: c + 1 },
      { row: r + 1, col: c },
    ],
    reveal: { row: r + 4, col: c + 4 },
    npc: `Sentinela ${code.slice(-4)}`,
  };
}

const client = io(URL, { transports: ["websocket"] });
const state = { last: null, errors: [] };
client.on("room:state", (st) => {
  state.last = st;
});
client.on("error", (e) => state.errors.push(e));

const join = () =>
  new Promise((resolve) => {
    client.emit("room:join", { code: CODE, name: "Mestre", role: "gm", key: GM_KEY }, (s) => {
      if (s?.ok) state.last = s;
      resolve(s);
    });
  });

await new Promise((resolve, reject) => {
  client.once("connect", resolve);
  client.once("connect_error", reject);
});

const joined = await join();
if (!joined?.ok) {
  console.error(`não deu para entrar como mestre: ${joined?.error ?? "?"}`);
  process.exit(1);
}

const scene = () => state.last?.scene;
const m = marks(CODE);

if (PHASE === "write") {
  console.log(`sala ${CODE} — escrevendo a cena marcada`);

  client.emit("map:walls", { op: "set", cells: m.walls });
  client.emit("map:fog", { op: "reveal", cells: [m.reveal] });
  client.emit("actor:add", { actor: { name: m.npc, row: 6, col: 6 } });

  await until(
    () => m.walls.every((w) => scene()?.walls?.[w.row]?.[w.col] === true),
    "as paredes marcadas",
  );
  check(true, `paredes gravadas em ${m.walls.map((w) => `${w.row},${w.col}`).join(" ")}`);

  await until(() => scene()?.fogExplored?.[m.reveal.row]?.[m.reveal.col] === 3, "o fog revelado");
  check(true, `fog revelado em ${m.reveal.row},${m.reveal.col}`);

  await until(() => scene()?.actors?.some((a) => a.name === m.npc), "o NPC marcado");
  check(true, `NPC "${m.npc}" no mapa`);

  // Sair é o que dispara a gravação (o último jogador esvazia a sala).
  client.disconnect();
  await sleep(400);
  console.log("\nOK — agora reinicie o servidor e rode de novo com PHASE=check");
  process.exit(0);
}

// ── PHASE=check ──────────────────────────────────────────────────────────────
console.log(`sala ${CODE} — conferindo o que voltou do banco`);

const wallsOk = m.walls.every((w) => scene()?.walls?.[w.row]?.[w.col] === true);
check(wallsOk, "as paredes voltaram exatamente onde estavam");

check(
  scene()?.fogExplored?.[m.reveal.row]?.[m.reveal.col] === 3,
  "o fog revelado pelo mestre voltou",
);

check(
  scene()?.actors?.some((a) => a.name === m.npc),
  `o NPC "${m.npc}" voltou`,
);

// O contador de versão, ao contrário, NÃO volta: é de sessão, não de conteúdo.
check(scene()?.version === 0, "a cena volta como versão 0 (contador não persiste)");

client.disconnect();
console.log(`\n${failures === 0 ? "TUDO OK" : `${failures} FALHA(S)`} — sala ${CODE}`);
process.exit(failures === 0 ? 0 : 1);
