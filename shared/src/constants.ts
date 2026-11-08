import type { FogMode, FogValue, Tool } from "./types";

// ── Grade ────────────────────────────────────────────────────────────────────
export const DEFAULT_COLS = 30;
export const DEFAULT_ROWS = 22;
export const DEFAULT_CELL = 48;

export const MINIMAP_W = 200;
export const MINIMAP_H = 150;

// ── Fog of War ───────────────────────────────────────────────────────────────
export const FOG_NONE: FogValue = 0; // nunca visto
export const FOG_SEEN: FogValue = 1; // visto antes, escuro
export const FOG_VIS: FogValue = 2; // visível agora (transitório)
export const FOG_REVEAL: FogValue = 3; // revelado pelo mestre (permanente)

// ── Movimento ────────────────────────────────────────────────────────────────
/** Velocidade de caminhada em células por segundo. */
export const WALK_SPEED = 5;
/** Frames de caminhada por segundo no spritesheet. */
export const WALK_FPS = 8;

// ── Ferramentas do editor ────────────────────────────────────────────────────
export const TOOLS = {
  MOVE: "move",
  WALL: "wall",
  WALL_EDGE: "wall_edge",
  WALL_WINDOW: "wall_window",
  ERASE: "erase",
  REVEAL: "reveal",
  HIDE: "hide",
  SECTOR: "sector",
} as const satisfies Record<string, Tool>;

export const FOG_MODES: FogMode[] = ["soft", "hard"];
export const WALL_DISPLAY_MODES = ["blocks", "thin", "invisible"] as const;


// ── Paleta ───────────────────────────────────────────────────────────────────
export const PALETTE = {
  bg: "#0d0b14",
  tile1: "#131020",
  tile2: "#17132a",
  wall: "#0a0810",
  wallLit: "#1a1528",
  fog0: "#04020a",
  fog1: "rgba(4,2,10,0.88)",
  accent: "#7c3aed",
  accentL: "#a78bfa",
  gold: "#d4a017",
};

export const SECTOR_COLORS = [
  "#d4a017", "#22d3ee", "#f87171", "#4ade80", "#fb923c", "#c084fc", "#38bdf8",
];

export const ACTOR_COLORS = [
  "#7c3aed", "#dc2626", "#059669", "#d97706", "#0891b2", "#db2777",
];
