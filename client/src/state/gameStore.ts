import { create } from "zustand";
import {
  ACTOR_COLORS,
  DEFAULT_CELL,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  FOG_NONE,
  SECTOR_COLORS,
} from "../game/constants";
import { makeFog, makeWalls, resizeGrid, clamp } from "../game/grid";
import { uid } from "../game/id";
import { facingBetween, findPath } from "../game/pathfinding";
import { computeVision } from "../game/vision";
import type {
  Actor,
  Cell,
  FogMode,
  FogValue,
  GameSnapshot,
  Sector,
} from "../game/types";

/**
 * Store do jogo — a fonte da verdade NO CLIENTE.
 *
 * Na Fase 2, o estado deixa de nascer aqui e passa a vir do servidor
 * (`room:state` / `room:patch`); as ações viram intenções enviadas por
 * `net/`. A forma do estado é intencionalmente igual à do servidor
 * (docs/ARQUITETURA.md) para essa troca ser só um adapter.
 *
 * Estado de UI (ferramenta ativa, pan, zoom, modais) NÃO mora aqui —
 * fica no componente. Ver docs/DECISOES.md #3.
 */

// ── Estado inicial ───────────────────────────────────────────────────────────
const INITIAL_WALLS = makeWalls(DEFAULT_ROWS, DEFAULT_COLS);
const INITIAL_ACTORS: Actor[] = [
  {
    id: "p1",
    name: "P1",
    ownerId: null,
    row: 3,
    col: 3,
    facing: "s",
    vision: 5,
    sprite: "hero",
    color: ACTOR_COLORS[0],
    canMove: true,
    path: [],
  },
];
const INITIAL_FOG = computeVision(
  makeFog(DEFAULT_ROWS, DEFAULT_COLS),
  INITIAL_WALLS,
  INITIAL_ACTORS,
  DEFAULT_ROWS,
  DEFAULT_COLS,
);

export interface GameState {
  // cena
  cols: number;
  rows: number;
  cell: number;
  bgImage: string | null;
  fogMode: FogMode;
  gmMode: boolean;

  // conteúdo
  fog: FogValue[][];
  walls: boolean[][];
  actors: Actor[];
  sectors: Sector[];

  // seleção
  activeActorId: string | null;

  // ── ações de configuração ──
  setDims: (rows: number, cols: number) => void;
  setCell: (cell: number) => void;
  setBgImage: (bg: string | null) => void;
  setFogMode: (mode: FogMode) => void;
  toggleGm: () => void;
  setGmMode: (v: boolean) => void;

  // ── ações de mapa ──
  resetFog: () => void;
  clearWalls: () => void;
  paintWalls: (cells: Cell[], value: boolean) => void;
  paintFog: (cells: Cell[], value: FogValue) => void;
  recomputeVision: () => void;

  // ── ações de ator ──
  addActor: (partial?: Partial<Actor>) => void;
  removeActor: (id: string) => void;
  updateActor: (id: string, patch: Partial<Actor>) => void;
  setActiveActor: (id: string | null) => void;
  /** Enfileira caminho até `goal` (predição local; servidor valida na Fase 2). */
  moveActorTo: (id: string, goal: Cell) => void;
  /** Avança a posição lógica para a próxima célula da fila. */
  advanceActor: (id: string) => void;
  clearActorPath: (id: string) => void;

  // ── setores ──
  addSector: (s: Omit<Sector, "id" | "color">) => void;
  removeSector: (id: string) => void;

  // ── serialização ──
  snapshot: () => GameSnapshot;
  loadSnapshot: (s: Partial<GameSnapshot>) => void;
}

export const useGameStore = create<GameState>()((set, get) => ({
  cols: DEFAULT_COLS,
  rows: DEFAULT_ROWS,
  cell: DEFAULT_CELL,
  bgImage: null,
  fogMode: "soft",
  gmMode: false,

  fog: INITIAL_FOG,
  walls: INITIAL_WALLS,
  actors: INITIAL_ACTORS,
  sectors: [],

  activeActorId: INITIAL_ACTORS[0].id,

  // ── configuração ──
  setDims: (rows, cols) => {
    const r = clamp(rows, 5, 60);
    const c = clamp(cols, 5, 80);
    set((s) => ({
      rows: r,
      cols: c,
      fog: resizeGrid(s.fog, r, c, FOG_NONE),
      walls: resizeGrid(s.walls, r, c, false),
    }));
    get().recomputeVision();
  },

  setCell: (cell) => set({ cell: clamp(cell, 16, 96) }),
  setBgImage: (bg) => set({ bgImage: bg }),
  setFogMode: (mode) => set({ fogMode: mode }),
  setGmMode: (v) => set({ gmMode: v }),
  toggleGm: () => set((s) => ({ gmMode: !s.gmMode })),

  // ── mapa ──
  resetFog: () => set((s) => ({ fog: makeFog(s.rows, s.cols) })),

  clearWalls: () => {
    set((s) => ({ walls: makeWalls(s.rows, s.cols) }));
    get().recomputeVision();
  },

  paintWalls: (cells, value) => {
    set((s) => {
      const walls = s.walls.map((row) => row.slice());
      for (const { row, col } of cells) {
        if (walls[row]?.[col] !== undefined) walls[row][col] = value;
      }
      return { walls };
    });
    get().recomputeVision();
  },

  paintFog: (cells, value) => {
    set((s) => {
      const fog = s.fog.map((row) => row.slice());
      for (const { row, col } of cells) {
        if (fog[row]?.[col] !== undefined) fog[row][col] = value;
      }
      return { fog };
    });
  },

  recomputeVision: () => {
    const { fog, walls, actors, rows, cols } = get();
    set({ fog: computeVision(fog, walls, actors, rows, cols) });
  },

  // ── atores ──
  addActor: (partial) => {
    set((s) => {
      const actor: Actor = {
        id: uid("tok"),
        name: `P${s.actors.length + 1}`,
        ownerId: null,
        row: Math.floor(s.rows / 2),
        col: Math.floor(s.cols / 2),
        facing: "s",
        vision: 4,
        sprite: "hero",
        color: ACTOR_COLORS[s.actors.length % ACTOR_COLORS.length],
        canMove: true,
        path: [],
        ...partial,
      };
      return { actors: [...s.actors, actor], activeActorId: actor.id };
    });
    get().recomputeVision();
  },

  removeActor: (id) => {
    set((s) => {
      const actors = s.actors.filter((a) => a.id !== id);
      return {
        actors,
        activeActorId:
          s.activeActorId === id ? (actors[0]?.id ?? null) : s.activeActorId,
      };
    });
    get().recomputeVision();
  },

  updateActor: (id, patch) => {
    set((s) => ({
      actors: s.actors.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  },

  setActiveActor: (id) => set({ activeActorId: id }),

  moveActorTo: (id, goal) => {
    const { walls, rows, cols, actors } = get();
    const actor = actors.find((a) => a.id === id);
    if (!actor) return;

    // Se já está andando, planeja a partir do fim do caminho atual.
    const start =
      actor.path.length > 0
        ? actor.path[actor.path.length - 1]
        : { row: actor.row, col: actor.col };

    const path = findPath(walls, start, goal, rows, cols);
    if (!path) return;

    set((s) => ({
      actors: s.actors.map((a) =>
        a.id === id ? { ...a, path: [...a.path, ...path] } : a,
      ),
    }));
  },

  advanceActor: (id) => {
    set((s) => {
      const actors = s.actors.map((a) => {
        if (a.id !== id || a.path.length === 0) return a;
        const next = a.path[0];
        return {
          ...a,
          row: next.row,
          col: next.col,
          facing: facingBetween({ row: a.row, col: a.col }, next),
          path: a.path.slice(1),
        };
      });
      return { actors };
    });
    get().recomputeVision();
  },

  clearActorPath: (id) => {
    set((s) => ({
      actors: s.actors.map((a) => (a.id === id ? { ...a, path: [] } : a)),
    }));
  },

  // ── setores ──
  addSector: (sector) => {
    set((s) => ({
      sectors: [
        ...s.sectors,
        {
          ...sector,
          id: uid("sec"),
          color: SECTOR_COLORS[s.sectors.length % SECTOR_COLORS.length],
        },
      ],
    }));
  },

  removeSector: (id) =>
    set((s) => ({ sectors: s.sectors.filter((x) => x.id !== id) })),

  // ── serialização ──
  snapshot: () => {
    const s = get();
    return {
      cols: s.cols,
      rows: s.rows,
      cell: s.cell,
      bgImage: s.bgImage,
      fogMode: s.fogMode,
      fog: s.fog,
      walls: s.walls,
      actors: s.actors,
      sectors: s.sectors,
    };
  },

  loadSnapshot: (data) => {
    set((s) => {
      const rows = data.rows ?? s.rows;
      const cols = data.cols ?? s.cols;
      return {
        cols,
        rows,
        cell: data.cell ?? s.cell,
        bgImage: data.bgImage ?? s.bgImage,
        fogMode: data.fogMode ?? s.fogMode,
        fog: data.fog ?? s.fog,
        walls: data.walls ?? s.walls,
        actors: data.actors ?? s.actors,
        sectors: data.sectors ?? s.sectors,
      };
    });
    get().recomputeVision();
  },
}));
