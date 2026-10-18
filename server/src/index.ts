/**
 * Servidor autoritativo do HELIO (Fase 2).
 *
 * O cliente pede; o servidor decide. Movimento, permissão, edição de mapa e
 * fog são validados aqui. Protocolo completo em docs/ARQUITETURA.md.
 */

import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
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
} from "@helio/shared";
import type { Actor, Cell, Role } from "@helio/shared";
import { createRoom, publicState, type Player, type Room } from "./room.js";
import { canMove } from "./validate.js";

const PORT = Number(process.env.PORT ?? 3000);
const ORIGIN = process.env.ORIGIN ?? "*";
const DEFAULT_ROOM = (process.env.ROOM_CODE ?? "HELIO").toUpperCase();
const MAX_NAME = 24;

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

// ── Helpers ──────────────────────────────────────────────────────────────────
function getOrCreateRoom(code: unknown): Room {
  const key = String(code ?? "").trim().toUpperCase().slice(0, 24) || DEFAULT_ROOM;
  let room = rooms.get(key);
  if (!room) {
    room = createRoom(key);
    rooms.set(key, room);
    console.log(`[sala] criada: ${key}`);
  }
  return room;
}

function roomOf(socketId: string): Room | null {
  for (const room of rooms.values()) {
    if (room.players.has(socketId)) return room;
  }
  return null;
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
  return actor;
}

/** Normaliza `{ cells: [{row, col}] }` vindo do cliente. */
function cellsOf(msg: unknown): Cell[] {
  const raw = (msg as { cells?: unknown })?.cells;
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => ({
    row: Number((c as Cell)?.row),
    col: Number((c as Cell)?.col),
  }));
}

// ── HTTP + Socket.IO ─────────────────────────────────────────────────────────
const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(httpServer, {
  cors: { origin: ORIGIN === "*" ? true : ORIGIN.split(",") },
});

function broadcast(room: Room): void {
  for (const id of room.players.keys()) {
    io.to(id).emit("room:state", publicState(room, id));
  }
}

function bump(room: Room): void {
  room.scene.version += 1;
  broadcast(room);
}

// ── Conexão ──────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  const me = (): { room: Room; player: Player } | null => {
    const room = roomOf(socket.id);
    if (!room) return null;
    const player = room.players.get(socket.id);
    return player ? { room, player } : null;
  };

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

  socket.on("room:join", (msg, ack) => {
    const m = (msg ?? {}) as { code?: unknown; role?: Role; name?: unknown; key?: unknown };
    const wantsGm = m.role === "gm";

    // Ser mestre exige a senha; entrar como jogador não exige nada. Recusamos a
    // entrada em vez de rebaixar em silêncio, senão a pessoa fica sem entender
    // por que não consegue mexer no mapa.
    if (wantsGm && !gmKeyMatches(String(m.key ?? ""))) {
      console.log(`[entrada] senha de mestre incorreta (${socket.id})`);
      if (typeof ack === "function") {
        ack({ ok: false, error: "Senha de mestre incorreta." });
      }
      return;
    }

    const room = getOrCreateRoom(m.code);
    const role: Role = wantsGm ? "gm" : "player";
    const name =
      String(m.name ?? "")
        .trim()
        .slice(0, MAX_NAME) || "Anônimo";

    const player: Player = {
      id: socket.id,
      name,
      role,
      actorId: null,
      canMoveGlobal: false,
    };
    room.players.set(socket.id, player);
    socket.join(room.code);

    if (role === "player") {
      const actor = spawnActor(room, player);
      player.actorId = actor.id;
    }

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
  socket.on("fog:discover", (msg) => {
    const m = me();
    if (!m) return;
    const grid = m.room.scene.fogExplored;
    let changed = false;
    for (const { row, col } of cellsOf(msg)) {
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

  socket.on("disconnect", () => {
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
      rooms.delete(room.code);
      console.log(`[sala] vazia, removida: ${room.code}`);
    } else {
      bump(room);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`HELIO server ouvindo em :${PORT} (sala padrão: ${DEFAULT_ROOM})`);
  console.log(
    GM_KEY
      ? "  entrada: jogador entra livre; MESTRE exige a senha (GM_KEY)"
      : "  entrada: SEM senha de mestre - qualquer um vira mestre (so rede local!)",
  );
});
