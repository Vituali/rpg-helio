import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  ACTOR_COLORS,
  DEFAULT_CELL,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  FOG_NONE,
  FOG_REVEAL,
  FOG_SEEN,
  SECTOR_COLORS,
  clamp,
  computeVision,
  facingBetween,
  findPath,
  makeFog,
  makeWalls,
  resizeGrid,
  uid,
} from "@helio/shared";
import type { Actor, Cell, FogMode, FogValue, GameSnapshot, Sector } from "@helio/shared";
import { isOnline, send } from "../net/bridge";
import { useNetStore } from "./netStore";

/**
 * Store do jogo — a fonte da verdade NO CLIENTE.
 *
 * Na Fase 2, o estado deixa de nascer aqui e passa a vir do servidor
 * (`room:state`); as ações viram intenções enviadas por `net/`. A forma do
 * estado é intencionalmente igual à do servidor (docs/ARQUITETURA.md) para
 * essa troca ser só um adapter.
 *
 * Modo local: sem conexão (`isOnline()` falso) tudo funciona como nas Fases
 * 0/1, com o próprio cliente mandando no estado — útil para o mestre preparar
 * o mapa sozinho.
 *
 * Estado de UI (ferramenta ativa, pan, zoom, modais) NÃO mora aqui —
 * fica no componente. Ver docs/DECISOES.md #3.
 */

/** Cena como o servidor manda: sem `fog` (visão atual) — só `fogExplored`. */
export interface ServerScene {
  cols: number;
  rows: number;
  cell: number;
  offsetX?: number;
  offsetY?: number;
  bgImage: string | null;
  fogMode: FogMode;
  walls: boolean[][];
  edgeWalls?: string[];
  edgeWindows?: string[];
  fogExplored: FogValue[][];
  actors: Actor[];
  sectors: Sector[];
  version: number;
}

/** Todas as células do mapa — para "limpar paredes" / "esconder fog". */
function allCells(rows: number, cols: number): Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) cells.push({ row, col });
  }
  return cells;
}

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
    portrait: "/tokens/token1.png",
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
  offsetX: number;
  offsetY: number;
  bgImage: string | null;
  fogMode: FogMode;
  gmMode: boolean;

  // conteúdo
  fog: FogValue[][];
  /** Visão atual do jogador logado (apenas o que SEU token enxerga). 0/2. */
  visibleNow: FogValue[][];
  walls: boolean[][];
  edgeWalls: string[];
  edgeWindows: string[];
  actors: Actor[];
  sectors: Sector[];

  // seleção
  activeActorId: string | null;

  // ── ações de configuração ──
  setDims: (rows: number, cols: number) => void;
  setCell: (cell: number) => void;
  setOffset: (offsetX: number, offsetY: number) => void;
  setBgImage: (bg: string | null) => void;
  setFogMode: (mode: FogMode) => void;
  toggleGm: () => void;
  setGmMode: (v: boolean) => void;

  // ── ações de mapa ──
  resetFog: () => void;
  clearWalls: () => void;
  paintWalls: (cells: Cell[], value: boolean) => void;
  paintEdgeWalls: (edges: string[], op: "set" | "clear" | "toggle") => void;
  paintEdgeWindows: (edges: string[], op: "set" | "clear" | "toggle") => void;
  paintFog: (cells: Cell[], value: FogValue) => void;
  recomputeVision: () => void;
  /** Recalcula a visão individual (visibleNow) baseada nos atores deste jogador. */
  computeMyVisibleNow: () => void;

  // ── ações de ator ──
  addActor: (partial?: Partial<Actor>) => void;
  removeActor: (id: string) => void;
  updateActor: (id: string, patch: Partial<Actor>) => void;
  teleportActor: (id: string, to: Cell) => void;
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

  // ── rede ──
  /** Aplica o estado autoritativo do servidor, preservando a predição local. */
  applyServerScene: (scene: ServerScene) => void;
  /** Desfaz a predição: cancela o caminho e volta para a posição confirmada. */
  snapActorTo: (id: string, at: Cell | null) => void;
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cell: DEFAULT_CELL,
      offsetX: 0,
      offsetY: 0,
      bgImage: null,
      fogMode: "soft",
      gmMode: false,

      fog: INITIAL_FOG,
      visibleNow: INITIAL_FOG,
      walls: INITIAL_WALLS,
      edgeWalls: [],
      edgeWindows: [],
      actors: INITIAL_ACTORS,
      sectors: [],

      activeActorId: INITIAL_ACTORS[0].id,

      // ── configuração ──
      // Em rede, quem manda é o servidor: manda a intenção e espera o `room:state`.
      setDims: (rows, cols) => {
        const r = clamp(rows, 5, 120);
        const c = clamp(cols, 5, 120);
        if (isOnline()) return send("map:config", { rows: r, cols: c });
        set((s) => ({
          rows: r,
          cols: c,
          fog: resizeGrid(s.fog, r, c, FOG_NONE),
          walls: resizeGrid(s.walls, r, c, false),
        }));
        get().recomputeVision();
        get().computeMyVisibleNow();
      },

      setCell: (cell) => {
        const value = clamp(cell, 12, 160);
        if (isOnline()) return send("map:config", { cell: value });
        set({ cell: value });
      },

      setOffset: (offsetX, offsetY) => {
        if (isOnline()) return send("map:config", { offsetX, offsetY });
        set({ offsetX, offsetY });
      },

      setBgImage: (bg) => {
        if (isOnline()) return send("map:config", { bgImage: bg });
        set({ bgImage: bg });
      },

      setFogMode: (mode) => {
        if (isOnline()) return send("map:config", { fogMode: mode });
        set({ fogMode: mode });
      },

      setGmMode: (v) => set({ gmMode: v }),
      toggleGm: () => set((s) => ({ gmMode: !s.gmMode })),

      // ── mapa ──
      resetFog: () => {
        if (isOnline()) {
          const { rows, cols } = get();
          return send("map:fog", { op: "hide", cells: allCells(rows, cols) });
        }
        set((s) => ({ fog: makeFog(s.rows, s.cols) }));
      },

      clearWalls: () => {
        if (isOnline()) {
          const { rows, cols } = get();
          send("map:edge-walls", { op: "clear", edges: [] });
          send("map:edge-windows", { op: "clear", edges: [] });
          return send("map:walls", { op: "clear", cells: allCells(rows, cols) });
        }
        set((s) => ({
          walls: makeWalls(s.rows, s.cols),
          edgeWalls: [],
          edgeWindows: [],
        }));
        get().recomputeVision();
        get().computeMyVisibleNow();
      },

      paintWalls: (cells, value) => {
        if (isOnline()) {
          return send("map:walls", { op: value ? "set" : "clear", cells });
        }
        set((s) => {
          const walls = s.walls.map((row) => row.slice());
          for (const { row, col } of cells) {
            if (walls[row]?.[col] !== undefined) walls[row][col] = value;
          }
          return { walls };
        });
        get().recomputeVision();
        get().computeMyVisibleNow();
      },

      paintEdgeWalls: (edges, op) => {
        if (isOnline()) {
          return send("map:edge-walls", { op, edges });
        }
        set((s) => {
          const setEdges = new Set(s.edgeWalls);
          for (const edge of edges) {
            if (op === "set") setEdges.add(edge);
            else if (op === "clear") setEdges.delete(edge);
            else if (op === "toggle") {
              if (setEdges.has(edge)) setEdges.delete(edge);
              else setEdges.add(edge);
            }
          }
          return { edgeWalls: Array.from(setEdges) };
        });
        get().recomputeVision();
        get().computeMyVisibleNow();
      },

      paintEdgeWindows: (edges, op) => {
        if (isOnline()) {
          return send("map:edge-windows", { op, edges });
        }
        set((s) => {
          const setEdges = new Set(s.edgeWindows);
          for (const edge of edges) {
            if (op === "set") setEdges.add(edge);
            else if (op === "clear") setEdges.delete(edge);
            else if (op === "toggle") {
              if (setEdges.has(edge)) setEdges.delete(edge);
              else setEdges.add(edge);
            }
          }
          return { edgeWindows: Array.from(setEdges) };
        });
        get().recomputeVision();
        get().computeMyVisibleNow();
      },

      paintFog: (cells, value) => {
        if (isOnline()) {
          return send("map:fog", {
            op: value === FOG_NONE ? "hide" : "reveal",
            cells,
          });
        }
        set((s) => {
          const fog = s.fog.map((row) => row.slice());
          for (const { row, col } of cells) {
            if (fog[row]?.[col] !== undefined) fog[row][col] = value;
          }
          return { fog };
        });
      },

      recomputeVision: () => {
        const { fog, walls, edgeWalls, edgeWindows, rows, cols } = get();
        const { actors } = get();
        const { status, role, you } = useNetStore.getState();

        /*
         * Fase 3: em partida online, `fog` guarda a união de duas coisas —
         * o que o servidor já conhece (0/1/3) e a visão ATUAL dos meus tokens
         * (2). Só os meus: usar a lista inteira faria o fog de cada jogador
         * incluir o raio de visão dos colegas (docs/ARQUITETURA.md).
         *
         * No modo local (sem servidor) e para o mestre, todos os atores contam.
         */
        const mine =
          status === "online" && role === "player"
            ? actors.filter((a) => a.ownerId === you)
            : actors;

        set({
          fog: computeVision(fog, walls, mine, rows, cols, edgeWalls, edgeWindows),
        });
      },
      computeMyVisibleNow: () => {
        const { fog, walls, edgeWalls, edgeWindows, actors, rows, cols } = get();
        const { status, role, you } = useNetStore.getState();

        // Mestre (e modo local) enxerga a cena inteira — o render nem aplica fog.
        if (status !== "online" || role !== "player" || !you) {
          set({ visibleNow: fog });
          return;
        }

        // Visão ATUAL: só os tokens deste jogador.
        const mine = actors.filter((a) => a.ownerId === you);
        const fresh = computeVision(
          fog.map((row) => row.map(() => FOG_NONE)),
          walls,
          mine,
          rows,
          cols,
          edgeWalls,
          edgeWindows,
        );

        /*
         * Memória: o que já foi explorado continua no mapa, só que escuro.
         * FOG_REVEAL fica nítido (revelação permanente do mestre).
         * FOG_VIS aqui é histórico local — `recomputeVision` acabou de
         * converter o VIS anterior em SEEN antes de chegarmos aqui.
         */
        for (let r = 0; r < rows; r += 1) {
          for (let c = 0; c < cols; c += 1) {
            if (fresh[r][c] !== FOG_NONE) continue;
            const explored = fog[r]?.[c] ?? FOG_NONE;
            if (explored === FOG_REVEAL) fresh[r][c] = FOG_REVEAL;
            else if (explored !== FOG_NONE) fresh[r][c] = FOG_SEEN;
          }
        }

        set({ visibleNow: fresh });
      },

      // ── atores ──
      addActor: (partial) => {
        if (isOnline()) return send("actor:add", { actor: partial ?? {} });
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
            portrait: null,
            color: ACTOR_COLORS[s.actors.length % ACTOR_COLORS.length],
            canMove: true,
            path: [],
            ...partial,
          };
          return { actors: [...s.actors, actor], activeActorId: actor.id };
        });
        get().recomputeVision();
        get().computeMyVisibleNow();
      },

      removeActor: (id) => {
        if (isOnline()) return send("actor:remove", { id });
        set((s) => {
          const actors = s.actors.filter((a) => a.id !== id);
          return {
            actors,
            activeActorId:
              s.activeActorId === id ? (actors[0]?.id ?? null) : s.activeActorId,
          };
        });
        get().recomputeVision();
        get().computeMyVisibleNow();
      },

      updateActor: (id, patch) => {
        if (isOnline()) return send("actor:update", { id, patch });
        set((s) => ({
          actors: s.actors.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        }));
      },

      teleportActor: (id, to) => {
        if (isOnline()) send("actor:teleport", { id, row: to.row, col: to.col });
        set((s) => ({
          actors: s.actors.map((a) => (a.id === id ? { ...a, row: to.row, col: to.col, path: [] } : a)),
        }));
        get().recomputeVision();
        get().computeMyVisibleNow();
      },

      setActiveActor: (id) => set({ activeActorId: id }),

      moveActorTo: (id, goal) => {
        const { walls, edgeWalls, edgeWindows, rows, cols, actors } = get();
        const actor = actors.find((a) => a.id === id);
        if (!actor) return;

        // Se já está andando, planeja a partir do fim do caminho atual.
        const start =
          actor.path.length > 0
            ? actor.path[actor.path.length - 1]
            : { row: actor.row, col: actor.col };

        const path = findPath(walls, start, goal, rows, cols, edgeWalls, edgeWindows);
        if (!path) return;

        set((s) => ({
          actors: s.actors.map((a) =>
            a.id === id ? { ...a, path: [...a.path, ...path] } : a,
          ),
        }));
      },

      advanceActor: (id) => {
        const current = get().actors.find((a) => a.id === id);
        const step = current?.path[0] ?? null;
        if (!step) return;

        set((s) => ({
          actors: s.actors.map((a) => {
            if (a.id !== id || a.path.length === 0) return a;
            const next = a.path[0];
            return {
              ...a,
              row: next.row,
              col: next.col,
              facing: facingBetween({ row: a.row, col: a.col }, next),
              path: a.path.slice(1),
            };
          }),
        }));

        // Andar é predição local; o servidor valida e desfaz se negar.
        send("actor:intent-move", { actorId: id, row: step.row, col: step.col });
        get().recomputeVision();
        get().computeMyVisibleNow();
      },

      clearActorPath: (id) => {
        if (isOnline()) send("actor:cancel-move", { actorId: id });
        set((s) => ({
          actors: s.actors.map((a) => (a.id === id ? { ...a, path: [] } : a)),
        }));
      },

      // ── setores ──
      addSector: (sector) => {
        if (isOnline()) return send("sector:add", sector);
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

      removeSector: (id) => {
        if (isOnline()) return send("sector:remove", { id });
        set((s) => ({ sectors: s.sectors.filter((x) => x.id !== id) }));
      },

      // ── serialização ──
      snapshot: () => {
        const s = get();
        return {
          cols: s.cols,
          rows: s.rows,
          cell: s.cell,
          offsetX: s.offsetX,
          offsetY: s.offsetY,
          bgImage: s.bgImage,
          fogMode: s.fogMode,
          fog: s.fog,
          walls: s.walls,
          edgeWalls: s.edgeWalls,
          edgeWindows: s.edgeWindows,
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
            offsetX: data.offsetX ?? s.offsetX,
            offsetY: data.offsetY ?? s.offsetY,
            bgImage: data.bgImage ?? s.bgImage,
            fogMode: data.fogMode ?? s.fogMode,
            fog: data.fog ?? s.fog,
            walls: data.walls ?? s.walls,
            edgeWalls: data.edgeWalls ?? s.edgeWalls,
            edgeWindows: data.edgeWindows ?? s.edgeWindows,
            actors: data.actors ?? s.actors,
            sectors: data.sectors ?? s.sectors,
          };
        });
        get().recomputeVision();
        get().computeMyVisibleNow();
      },

      // ── rede ──
      applyServerScene: (scene) => {
        set((s) => {
          const locals = new Map(s.actors.map((a) => [a.id, a]));
          return {
            cols: scene.cols,
            rows: scene.rows,
            cell: scene.cell,
            offsetX: scene.offsetX ?? 0,
            offsetY: scene.offsetY ?? 0,
            bgImage: scene.bgImage,
            fogMode: scene.fogMode,
            walls: scene.walls,
            edgeWalls: scene.edgeWalls ?? [],
            edgeWindows: scene.edgeWindows ?? [],
            sectors: scene.sectors,
            // O servidor guarda o fog no mesmo formato do cliente (0/1/3);
            // a visão atual (2) é recalculada logo abaixo.
            fog: scene.fogExplored,
            actors: scene.actors.map((a) => {
              const local = locals.get(a.id);
              // Preserva o caminho que está sendo previsto localmente — o servidor
              // não conhece `path`, e apagá-lo faria o token parar no meio do passo.
              return local && local.path.length > 0 ? { ...a, path: local.path } : a;
            }),
          };
        });
        get().recomputeVision();
        get().computeMyVisibleNow();
      },

      snapActorTo: (id, at) => {
        set((s) => ({
          actors: s.actors.map((a) =>
            a.id === id
              ? { ...a, path: [], ...(at ? { row: at.row, col: at.col } : {}) }
              : a,
          ),
        }));
        get().recomputeVision();
        get().computeMyVisibleNow();
      },
    }),
    {
      name: "helio-game-store",
      storage: createJSONStorage(() => localStorage),
      // Só persiste o que faz sentido no modo local (sem servidor).
      // Ações (funções) não são serializadas — o Zustand já as exclui.
      partialize: (state: GameState) => ({
        cols: state.cols,
        rows: state.rows,
        cell: state.cell,
        offsetX: state.offsetX,
        offsetY: state.offsetY,
        bgImage: state.bgImage,
        fogMode: state.fogMode,
        walls: state.walls,
        edgeWalls: state.edgeWalls,
        edgeWindows: state.edgeWindows,
        fog: state.fog,
        actors: state.actors,
        sectors: state.sectors,
      }),
    },
  ),
);
