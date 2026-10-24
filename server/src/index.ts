/**
 * Servidor autoritativo do HELIO (Fase 2).
 *
 * O cliente pede; o servidor decide. Movimento, permissão, edição de mapa e
 * fog são validados aqui. Protocolo completo em docs/ARQUITETURA.md.
 */

import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "socket.io";
import {
  ACTOR_COLORS,
  FOG_NONE,
  FOG_REVEAL,
  FOG_SEEN,
  SECTOR_COLORS,
  clamp,
  facingBetween,
  resizeGrid,
  uid,
  visibleCellsFrom,
} from "@helio/shared";
import type { Actor, Cell, Role } from "@helio/shared";
import { touchMembership } from "./accounts.js";
import { SESSION_COOKIE, cookieValue, readSession, sessionEnabled } from "./auth.js";
import { dbEnabled } from "./db.js";
import { handleHttp, registrationOpen } from "./http.js";
import { onRoleChange } from "./live.js";
import { migrate } from "./migrate.js";
import { createRoom, publicState, type Player, type Room } from "./room.js";
import { normalizeCode } from "./selo.js";
import {
  ensureDefaultCampaign,
  findCampaign,
  flushRoom,
  loadScene,
  scheduleSave,
  seedMaster,
  setDefaultGmAccount,
  type CampaignRef,
} from "./store.js";
import { canMove } from "./validate.js";

const PORT = Number(process.env.PORT ?? 3000);
const ORIGIN = process.env.ORIGIN ?? "*";
const DEFAULT_ROOM = (process.env.ROOM_CODE ?? "HELIO").toUpperCase();

/**
 * Teto de células aceitas numa única mensagem. O maior tabuleiro possível é
 * 80x60 = 4800 (`map:config` limita nisso), então 5000 cobre qualquer seleção
 * legítima e barra um payload absurdo, tipo 1 milhão de células.
 */
const MAX_CELLS = 5000;

/**
 * Limite de taxa por conexão (token bucket).
 *
 * Dói mais do que o normal porque CADA evento aceito transmite a cena inteira
 * para todos os jogadores. Sem isto, um cliente mandando mensagens em loop
 * trava a mesa de todo mundo (Node é single-thread). Os padrões são ~15x o uso
 * legítimo, então não incomodam quem joga.
 */
const RATE_PER_SEC = Number(process.env.RATE_PER_SEC ?? 60);
const RATE_BURST = Number(process.env.RATE_BURST ?? 150);
/** Pacotes descartados seguidos antes de derrubar a conexão de vez. */
const RATE_STRIKES = Number(process.env.RATE_STRIKES ?? 600);

/**
 * Senha para ENTRAR COMO MESTRE. Vazia = sem senha (aceitável só em rede local).
 *
 * Isto NÃO é autenticação: qualquer um entra como jogador, e quem sabe a senha
 * vira mestre. É deliberadamente mínimo — resolve o único risco que existe hoje,
 * que é um estranho achar a URL pública e assumir a mesa. Um RBAC de verdade
 * (contas, papéis, permissão por token, sessão assinada) é a Fase 4;
 * ver docs/DECISOES.md #12.
 */
const GM_KEY = (process.env.GM_KEY ?? "").trim();

/** Todas as salas vivas, por código. */
const rooms = new Map<string, Room>();

/** Salas sendo carregadas do banco — evita duas cargas em corrida. */
const loading = new Map<string, Promise<Room>>();

// ── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Forma canônica do selo da sala. Vazio cai no selo sugerido do servidor
 * (`ROOM_CODE`) — é o que mantém o hábito do grupo funcionando.
 */
function normalizeCodeOr(code: unknown): string {
  return normalizeCode(code) || DEFAULT_ROOM;
}

/**
 * Sala viva, ou criada a partir do banco (ADR #17).
 *
 * Primeira entrada numa campanha carrega a cena persistida; sem banco, é a cena
 * nova de sempre. O `loading` existe porque dois jogadores entrando ao mesmo
 * tempo não podem carregar duas cenas — a segunda sobrescreveria a primeira.
 *
 * A campanha chega **já resolvida** por quem chamou: quem julga o selo é
 * `room:join` (ADR #18), e esta função só cuida da sala.
 */
async function getOrCreateRoom(key: string, campaign: CampaignRef | null): Promise<Room> {
  const living = rooms.get(key);
  if (living) return living;

  const inFlight = loading.get(key);
  if (inFlight) return inFlight;

  const task = (async () => {
    const room = createRoom(key, campaign?.id ?? null, campaign?.name ?? key);
    const saved = await loadScene(room.campaignId);
    if (saved) room.scene = saved;
    rooms.set(key, room);
    console.log(`[sala] criada: ${key}${room.campaignId ? "" : " (sem banco)"}`);
    return room;
  })();

  loading.set(key, task);
  try {
    return await task;
  } finally {
    loading.delete(key);
  }
}

function roomOf(socketId: string): Room | null {
  for (const room of rooms.values()) {
    if (room.players.has(socketId)) return room;
  }
  return null;
}

/**
 * Descarta uma sala que ficou sem ninguém **antes** de alguém entrar.
 *
 * Acontece quando a entrada é recusada: a sala foi carregada para decidir o
 * papel, e sem isto ela ficaria para sempre em memória, vazia e invisível.
 */
function dropIfEmpty(room: Room): void {
  if (room.players.size > 0) return;
  rooms.delete(room.code);
  console.log(`[sala] vazia, descartada: ${room.code}`);
}

/**
 * Confere a senha de mestre. Sem `GM_KEY` configurada, não há o que conferir.
 * A comparação é de tempo constante para não entregar a senha por temporização.
 */
function gmKeyMatches(given: string): boolean {
  if (GM_KEY === "") return true;
  const a = Buffer.from(given);
  const b = Buffer.from(GM_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

function spawnActor(room: Room, player: Player): Actor {
  const s = room.scene;
  const n = s.actors.length;
  const actor: Actor = {
    id: uid("tok"),
    name: player.name,
    ownerId: player.id,
    row: 3,
    col: clamp(3 + n, 0, s.cols - 1),
    facing: "s",
    vision: 5,
    sprite: "hero",
    portrait: null,
    color: ACTOR_COLORS[n % ACTOR_COLORS.length],
    canMove: false,
    path: [],
  };
  s.actors.push(actor);
  room.pcActors.add(actor.id);
  return actor;
}

/** Normaliza `{ cells: [{row, col}] }` vindo do cliente. Nunca confie no tamanho. */
function cellsOf(msg: unknown): Cell[] {
  const raw = (msg as { cells?: unknown })?.cells;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_CELLS).map((c) => ({
    row: Number((c as Cell)?.row),
    col: Number((c as Cell)?.col),
  }));
}

/**
 * O teto do que um jogador pode revelar: a união do que TODOS os atores
 * enxergam agora, calculada aqui com a MESMA função que o cliente usa.
 *
 * Isto é o que um cliente honesto reporta — `reportNewFog` manda a visão
 * compartilhada — então nada legítimo é recusado. Mas ninguém consegue mais
 * marcar o mapa inteiro numa mensagem e apagar o fog de guerra da mesa.
 * Quem decide o que foi revelado é o servidor, não o cliente.
 */
function discoverableCells(room: Room): Set<string> {
  const s = room.scene;
  const out = new Set<string>();
  for (const a of s.actors) {
    const seen = visibleCellsFrom(
      s.walls,
      { row: a.row, col: a.col },
      a.vision ?? 5,
      s.rows,
      s.cols,
    );
    for (const c of seen) out.add(`${c.row},${c.col}`);
  }
  return out;
}

// ── HTTP + Socket.IO ─────────────────────────────────────────────────────────
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? "").split("?")[0];

  if (path === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  // Autenticação (ADR #16). O jogo em si não passa por HTTP.
  if (await handleHttp(req, res)) return;

  res.writeHead(404);
  res.end();
}

const httpServer = createServer((req, res) => {
  handleRequest(req, res).catch((err: unknown) => {
    // Nunca devolve o erro para fora: um 500 seco, e o detalhe fica no log.
    console.error(`[http] erro em ${req.url}: ${(err as Error).message}`);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

/**
 * Aceita só conexão de MESMA ORIGEM.
 *
 * A página sempre é servida pelo mesmo host que fala com o socket (Caddy numa
 * ponta, o túnel na outra), então origem igual é o esperado. Sem isto,
 * `origin: true` deixava qualquer site abrir um socket aqui a partir do
 * navegador da vítima. Requisição sem cabeçalho `Origin` passa: aí não existe
 * navegador para ser enganado (é o caso do smoke e de qualquer script).
 */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin === "") return true;
  if (ORIGIN !== "*" && ORIGIN.split(",").includes(origin)) return true;
  try {
    return new URL(origin).host === (req.headers.host ?? "");
  } catch {
    return false;
  }
}

const io = new Server(httpServer, {
  // Payload máximo: 256 KB. Um tabuleiro cheio (4800 células) cabe folgado.
  maxHttpBufferSize: 256 * 1024,
  cors: { origin: ORIGIN === "*" ? true : ORIGIN.split(",") },
  allowRequest: (req, cb) => cb(null, sameOrigin(req)),
});

function broadcast(room: Room): void {
  for (const id of room.players.keys()) {
    io.to(id).emit("room:state", publicState(room, id));
  }
}

function bump(room: Room): void {
  room.scene.version += 1;
  broadcast(room);
  // A gravação é com debounce: a cena viva manda, o banco só guarda (ADR #17).
  scheduleSave(room);
}

/**
 * O papel mudou no banco (ADR #22): faz valer na mesa que já está aberta.
 *
 * Não é `bump`: a cena não mudou, e portanto não há o que gravar. Só a lista de
 * jogadores precisa ser reenviada — e é ela que o cliente usa para descobrir o
 * próprio papel (o `applyState` lê `me.role` a cada `room:state`).
 *
 * Rebaixar um mestre para agente dá a ele o token que todo agente tem; promover
 * não tira nada (um mestre com token continua mestre — só passou a poder tudo).
 */
onRoleChange(({ code, name, role }) => {
  const room = rooms.get(code);
  if (!room) return;
  const alvo = name.toLowerCase();
  let mudou = false;
  for (const p of room.players.values()) {
    if (p.name.toLowerCase() !== alvo || p.role === role) continue;
    p.role = role;
    mudou = true;
    if (role === "player" && p.actorId === null) {
      p.actorId = spawnActor(room, p).id;
    }
  }
  if (!mudou) return;
  console.log(`[${code}] ${name} agora e ${role} (sessao aberta)`);
  if (role === "player") {
    bump(room); // o token novo é cena: aí sim precisa gravar
  } else {
    broadcast(room);
  }
});

// ── Conexão ──────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  /**
   * Quem está logado nesta conexão, se alguém estiver.
   *
   * Isto é o coração do ADR #16: o Socket.IO manda os cookies do mesmo domínio
   * **no handshake**, então a identidade chega junto com a conexão. Não existe
   * mensagem para "autenticar" — e por isso não há como esquecer de autenticar
   * um evento novo.
   */
  const account = readSession(
    cookieValue(socket.handshake.headers.cookie, SESSION_COOKIE),
  );

  // ── Limite de taxa (token bucket por conexão) ──
  // Vale para TODOS os eventos, inclusive os futuros, porque roda no
  // middleware de pacote do Socket.IO. Pacote barrado é descartado em
  // silêncio (não chama `next()`): não vale gastar banda explicando para quem
  // está só tentando derrubar a mesa.
  let tokens = RATE_BURST;
  let last = Date.now();
  let strikes = 0;

  socket.use((_packet, next) => {
    const now = Date.now();
    tokens = Math.min(RATE_BURST, tokens + ((now - last) / 1000) * RATE_PER_SEC);
    last = now;
    if (tokens >= 1) {
      tokens -= 1;
      strikes = 0;
      return next();
    }
    strikes += 1;
    if (strikes === RATE_STRIKES) {
      console.log(`[limite] ${socket.id} estourou o limite - desconectando`);
      socket.disconnect(true);
    }
    return undefined;
  });

  const me = (): { room: Room; player: Player } | null => {
    const room = roomOf(socket.id);
    if (!room) return null;
    const player = room.players.get(socket.id);
    return player ? { room, player } : null;
  };

  /**
   * Selos errados nesta conexão. Existe porque adivinhar o selo é a única porta
   * que depende de palpite (ADR #18): sem contador, uma conexão pode varrer
   * selos na velocidade do limite de pacotes. Ao passar do teto, a conexão cai —
   * errar o selo é raro, então quem chega aqui está tentando.
   */
  let wrongSelos = 0;
  const MAX_WRONG_SELOS = 20;

  const deny = (msg: string) => socket.emit("error", { code: "DENIED", msg });

  /** Só o mestre passa daqui. */
  const requireGm = (): Room | null => {
    const m = me();
    if (!m) return null;
    if (m.player.role !== "gm") {
      deny("Só o mestre pode fazer isso.");
      return null;
    }
    return m.room;
  };

  socket.on("room:join", async (msg, ack) => {
    const m = (msg ?? {}) as { code?: unknown; key?: unknown };
    const key = normalizeCodeOr(m.code);
    const givenKey = typeof m.key === "string" ? m.key : "";

    /*
     * A conta é a porta (ADR #20).
     *
     * Até a entrega 4, o convidado entrava só com o nome: a conta era um
     * upgrade, não um pedágio. Mas o papel passou a vir do vínculo e o nome, da
     * conta — e aí o convidado virou um jogador sem nome estável, sem como ser
     * promovido e sem linha no quadro de membros. A entrada sem conta fechou.
     *
     * Sem `SESSION_SECRET` não existe login, e a mesa **não abre no escuro**: a
     * recusa é a mesma, e o boot grita sobre a variável que falta.
     */
    if (!account) {
      console.log(`[entrada] recusada sem conta (${socket.id})`);
      if (typeof ack === "function") {
        ack({ ok: false, error: "Entre com a sua conta para jogar." });
      }
      return;
    }

    /*
     * O selo precisa existir (ADR #18). Antes, um selo novo criava a campanha na
     * hora — e qualquer um com a URL criava campanha sem limite.
     *
     * Mas "não existe" e "não deu para saber" são coisas diferentes: sem banco
     * não há veredito, e recusar todo mundo transformaria "banco caiu" em "mesa
     * não abre", que é justamente o que o ADR #17 proíbe. Só recusamos quando o
     * banco respondeu e disse que o selo não existe.
     */
    const lookup = await findCampaign(key, account.accountId);
    if (lookup.checked && !lookup.campaign) {
      wrongSelos += 1;
      console.log(`[entrada] selo desconhecido: ${key} (${wrongSelos} nesta conexao)`);
      if (typeof ack === "function") {
        ack({
          ok: false,
          error: `Selo desconhecido: "${key}". Confira com o mestre.`,
        });
      }
      if (wrongSelos >= MAX_WRONG_SELOS) {
        console.warn(`[entrada] ${socket.id} errou o selo ${wrongSelos}x — desconectando`);
        socket.disconnect(true);
      }
      return;
    }

    const room = await getOrCreateRoom(key, lookup.campaign);

    /*
     * Mestre é quem tem **vínculo de mestre** com a missão (ADRs #19 e #20).
     *
     * O cliente não pede papel: ele entra, e o servidor diz o que ele é. Quem
     * criou a missão recebe o vínculo na criação, e quem foi promovido recebe
     * pela rota de papel (ADR #22). Não existe mais "escolhi MESTRE na tela".
     *
     * A `GM_KEY` continua valendo como escapatória, e só quando existe uma
     * configurada: ela não escreve vínculo nenhum (é uma senha compartilhada, e
     * promover alguém com ela seria promover o grupo inteiro em silêncio).
     * Digitar uma chave é uma declaração de intenção — "quero entrar como
     * mestre" —, e por isso a chave errada é dita na cara em vez de virar um
     * rebaixamento silencioso.
     */
    const isGmMember = lookup.campaign?.memberRole === "gm";
    const keyOk = GM_KEY !== "" && givenKey !== "" && gmKeyMatches(givenKey);
    if (givenKey !== "" && !isGmMember && !keyOk) {
      console.log(
        `[entrada] senha de mestre recusada em ${room.code}: conta ${account.name} sem vinculo (${socket.id})`,
      );
      dropIfEmpty(room);
      if (typeof ack === "function") {
        ack({
          ok: false,
          error: "Senha de mestre incorreta.",
        });
      }
      return;
    }

    const role: Role = isGmMember || keyOk ? "gm" : "player";
    // O nome vem da conta: não há campo de nome na entrada (ADR #20/#21).
    const name = account.name;

    const player: Player = {
      id: socket.id,
      name,
      role,
      accountId: account.accountId,
      actorId: null,
      canMoveGlobal: false,
    };
    room.players.set(socket.id, player);
    socket.join(room.code);

    if (role === "player") {
      const actor = spawnActor(room, player);
      player.actorId = actor.id;
    }

    // Registra que esta conta passou por esta campanha (ADR #19). Sem await: é
    // livro-caixa, e a partida não espera por ele.
    void touchMembership(account.accountId, room.campaignId);

    console.log(`[${room.code}] ${name} entrou como ${role}`);
    if (typeof ack === "function") {
      ack({ ok: true, ...publicState(room, socket.id) });
    }
    bump(room);
  });

  // ── Movimento ──
  socket.on("actor:intent-move", (msg) => {
    const m = me();
    if (!m) return;
    const actorId = String((msg as { actorId?: unknown })?.actorId ?? "");
    const to: Cell = {
      row: Number((msg as Cell)?.row),
      col: Number((msg as Cell)?.col),
    };

    const verdict = canMove(m.room, m.player, actorId, to);
    if (!verdict.ok) {
      socket.emit("error", {
        code: "MOVE_DENIED",
        msg: verdict.reason ?? "Movimento negado.",
        actorId,
      });
      return;
    }

    const actor = m.room.scene.actors.find((a) => a.id === actorId);
    if (!actor) return;
    actor.facing = facingBetween({ row: actor.row, col: actor.col }, to);
    actor.row = to.row;
    actor.col = to.col;
    bump(m.room);
  });

  // ── Fog que o token do jogador acabou de enxergar ──
  //
  // O cliente NÃO decide o que foi revelado: ele só sugere. O servidor calcula
  // a visão real dos atores e aceita apenas o que está dentro dela. Antes, o
  // cliente era dono da verdade e um jogador qualquer podia mandar o tabuleiro
  // inteiro numa mensagem e apagar o fog de guerra de todo mundo.
  socket.on("fog:discover", (msg) => {
    const m = me();
    if (!m) return;
    const grid = m.room.scene.fogExplored;
    const allowed = discoverableCells(m.room);
    let changed = false;
    for (const { row, col } of cellsOf(msg)) {
      if (!allowed.has(`${row},${col}`)) continue;
      if (grid[row]?.[col] === FOG_NONE) {
        grid[row][col] = FOG_SEEN;
        changed = true;
      }
    }
    if (changed) bump(m.room);
  });

  // ── Edição de mapa (mestre) ──
  socket.on("map:walls", (msg) => {
    const room = requireGm();
    if (!room) return;
    const value = (msg as { op?: string })?.op !== "clear";
    for (const { row, col } of cellsOf(msg)) {
      if (room.scene.walls[row]?.[col] !== undefined) {
        room.scene.walls[row][col] = value;
      }
    }
    bump(room);
  });

  socket.on("map:fog", (msg) => {
    const room = requireGm();
    if (!room) return;
    const value = (msg as { op?: string })?.op === "hide" ? FOG_NONE : FOG_REVEAL;
    for (const { row, col } of cellsOf(msg)) {
      if (room.scene.fogExplored[row]?.[col] !== undefined) {
        room.scene.fogExplored[row][col] = value;
      }
    }
    bump(room);
  });

  socket.on("map:config", (msg) => {
    const room = requireGm();
    if (!room) return;
    const s = room.scene;
    const m = msg as {
      cols?: number;
      rows?: number;
      cell?: number;
      bgImage?: string | null;
      fogMode?: "soft" | "hard";
    };

    if (typeof m.cols === "number" || typeof m.rows === "number") {
      const rows = clamp(Number(m.rows ?? s.rows), 5, 60);
      const cols = clamp(Number(m.cols ?? s.cols), 5, 80);
      s.rows = rows;
      s.cols = cols;
      s.walls = resizeGrid(s.walls, rows, cols, false);
      s.fogExplored = resizeGrid(s.fogExplored, rows, cols, FOG_NONE);
    }
    if (typeof m.cell === "number") s.cell = clamp(m.cell, 16, 96);
    if (m.bgImage !== undefined) s.bgImage = m.bgImage;
    if (m.fogMode === "soft" || m.fogMode === "hard") s.fogMode = m.fogMode;
    bump(room);
  });

  // ── Atores (mestre) ──
  socket.on("actor:add", (msg) => {
    const room = requireGm();
    if (!room) return;
    const partial = (msg as { actor?: Partial<Actor> })?.actor ?? {};
    const s = room.scene;
    const n = s.actors.length;
    s.actors.push({
      id: uid("tok"),
      name: partial.name ?? `NPC ${n + 1}`,
      ownerId: null,
      row: clamp(partial.row ?? Math.floor(s.rows / 2), 0, s.rows - 1),
      col: clamp(partial.col ?? Math.floor(s.cols / 2), 0, s.cols - 1),
      facing: "s",
      vision: partial.vision ?? 4,
      sprite: partial.sprite ?? "hero",
      portrait: partial.portrait ?? null,
      color: partial.color ?? ACTOR_COLORS[n % ACTOR_COLORS.length],
      canMove: partial.canMove ?? true,
      path: [],
    });
    bump(room);
  });

  socket.on("actor:update", (msg) => {
    const room = requireGm();
    if (!room) return;
    const { id, patch } = msg as { id?: string; patch?: Partial<Actor> };
    const actor = room.scene.actors.find((a) => a.id === id);
    if (!actor) return;
    // `path` é predição do cliente, não existe no servidor.
    const { path: _path, ...safe } = patch ?? {};
    Object.assign(actor, safe);
    bump(room);
  });

  socket.on("actor:remove", (msg) => {
    const room = requireGm();
    if (!room) return;
    const id = (msg as { id?: string })?.id;
    room.scene.actors = room.scene.actors.filter((a) => a.id !== id);
    for (const p of room.players.values()) {
      if (p.actorId === id) p.actorId = null;
    }
    bump(room);
  });

  // ── Setores (mestre) ──
  socket.on("sector:add", (msg) => {
    const room = requireGm();
    if (!room) return;
    const s = room.scene;
    const d = msg as {
      name?: string;
      r1?: number;
      c1?: number;
      r2?: number;
      c2?: number;
    };
    s.sectors.push({
      id: uid("sec"),
      name: String(d.name ?? "Setor").slice(0, 40),
      r1: Number(d.r1 ?? 0),
      c1: Number(d.c1 ?? 0),
      r2: Number(d.r2 ?? 0),
      c2: Number(d.c2 ?? 0),
      color: SECTOR_COLORS[s.sectors.length % SECTOR_COLORS.length],
    });
    bump(room);
  });

  socket.on("sector:remove", (msg) => {
    const room = requireGm();
    if (!room) return;
    const id = (msg as { id?: string })?.id;
    room.scene.sectors = room.scene.sectors.filter((x) => x.id !== id);
    bump(room);
  });

  // ── Permissões (mestre) ──
  socket.on("perm:set", (msg) => {
    const room = requireGm();
    if (!room) return;
    const m = msg as {
      playerId?: string;
      canMoveGlobal?: boolean;
      actorId?: string;
      canMove?: boolean;
    };
    if (m.playerId && typeof m.canMoveGlobal === "boolean") {
      const p = room.players.get(m.playerId);
      if (p) p.canMoveGlobal = m.canMoveGlobal;
    }
    if (m.actorId && typeof m.canMove === "boolean") {
      const a = room.scene.actors.find((x) => x.id === m.actorId);
      if (a) a.canMove = m.canMove;
    }
    bump(room);
  });

  // ── Vincular jogador a um ator (mestre) ──
  socket.on("player:assign", (msg) => {
    const room = requireGm();
    if (!room) return;
    const m = msg as { playerId?: string; actorId?: string | null };
    const p = m.playerId ? room.players.get(m.playerId) : undefined;
    if (!p) return;
    p.actorId = m.actorId ?? null;
    const a = room.scene.actors.find((x) => x.id === p.actorId);
    if (a) a.ownerId = p.id;
    bump(room);
  });

  socket.on("disconnect", async () => {
    const room = roomOf(socket.id);
    if (!room) return;
    const p = room.players.get(socket.id);
    room.players.delete(socket.id);
    // O token fica no mapa, agora sem dono (o mestre controla).
    if (p?.actorId) {
      const a = room.scene.actors.find((x) => x.id === p.actorId);
      if (a) a.ownerId = null;
    }
    console.log(`[${room.code}] ${p?.name ?? socket.id} saiu`);

    if (room.players.size === 0) {
      // Último momento em que a sala existe: grava antes de esquecer. É o que
      // faz o F5 (e o restart do container) não apagar a mesa.
      await flushRoom(room);
      if (room.players.size > 0) return; // alguém entrou enquanto gravávamos
      rooms.delete(room.code);
      console.log(`[sala] vazia, removida: ${room.code}`);
    } else {
      bump(room);
    }
  });
});

/**
 * Boot. O banco vem primeiro, mas **não pode impedir o servidor de subir**
 * (ADR #17): se o Postgres estiver fora, a mesa funciona em memória e a
 * partida não é perdida por causa do banco.
 *
 * A espera existe para cobrir a corrida normal do compose — o `app` sobe
 * enquanto o Postgres ainda está inicializando. Não é `service_healthy` de
 * propósito: banco quebrado não pode impedir a mesa de abrir.
 */
async function connectDatabase(): Promise<void> {
  const attempts = 6;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await migrate();
      setDefaultGmAccount(await seedMaster());
      // O selo sugerido do lobby precisa existir (ADR #18): num banco novo, todo
      // mundo receberia "selo desconhecido" na primeira vez. É a única criação
      // de carona que sobrou, e ela acontece uma vez, aqui.
      await ensureDefaultCampaign(DEFAULT_ROOM);
      console.log("[banco] conectado (migrations em dia)");
      return;
    } catch (err) {
      const last = i === attempts;
      console.warn(
        `[banco] tentativa ${i}/${attempts} falhou: ${(err as Error).message}` +
          (last ? " — seguindo em memória" : ""),
      );
      if (last) return;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function main(): Promise<void> {
  if (!dbEnabled) {
    console.log("[banco] DATABASE_URL vazia — salas só em memória, nada persiste");
  } else {
    await connectDatabase();
  }

  httpServer.listen(PORT, () => {
    console.log(`HELIO server ouvindo em :${PORT} (sala padrão: ${DEFAULT_ROOM})`);
    console.log(
      sessionEnabled
        ? "  contas: login ligado (cookie de sessao assinado) - a mesa so abre com conta"
        : "  contas: SEM SESSION_SECRET - NINGUEM ENTRA, configure SESSION_SECRET",
    );
    console.log(
      GM_KEY
        ? "  papel: vinculo com a missao; GM_KEY e a escapatoria (nao escreve vinculo)"
        : "  papel: so o vinculo com a missao (sem GM_KEY configurada)",
    );
    console.log(
      registrationOpen
        ? "  cadastro: aberto - qualquer um cria conta (REGISTRATION=closed fecha)"
        : "  cadastro: FECHADO - so entram contas que ja existem",
    );
  });
}

void main();
