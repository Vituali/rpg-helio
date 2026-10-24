import { FOG_NONE, FOG_SEEN, FOG_VIS } from "./constants";
import { inBounds } from "./grid";
import type { Cell, FogValue } from "./types";

function segmentsIntersect(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  p3x: number,
  p3y: number,
): boolean {
  const s1x = p1x - p0x;
  const s1y = p1y - p0y;
  const s2x = p3x - p2x;
  const s2y = p3y - p2y;

  const denom = -s2x * s1y + s1x * s2y;
  if (Math.abs(denom) < 1e-7) return false;

  const s = (-s1y * (p0x - p2x) + s1x * (p0y - p2y)) / denom;
  const t = (s2x * (p0y - p2y) - s2y * (p0x - p2x)) / denom;

  return s > 0.001 && s < 0.999 && t > 0.001 && t < 0.999;
}

function edgeIntersectsRay(
  edgeKey: string,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): boolean {
  const parts = edgeKey.split(",");
  if (parts.length < 3) return false;
  const r = Number(parts[0]);
  const c = Number(parts[1]);
  const orient = parts[2];

  const p0x = c1 + 0.5;
  const p0y = r1 + 0.5;
  const p1x = c2 + 0.5;
  const p1y = r2 + 0.5;

  if (orient === "h") {
    // Borda horizontal no topo da célula (r, c): de (c, r) até (c+1, r)
    return segmentsIntersect(p0x, p0y, p1x, p1y, c, r, c + 1, r);
  } else if (orient === "v") {
    // Borda vertical na esquerda da célula (r, c): de (c, r) até (c, r+1)
    return segmentsIntersect(p0x, p0y, p1x, p1y, c, r, c, r + 1);
  }
  return false;
}

/**
 * Line of Sight por Bresenham: há visão de (r1,c1) para (r2,c2) se nenhuma
 * parede em bloco ou parede de borda bloquear o caminho entre os centros das células.
 */
export function hasLOS(
  walls: boolean[][],
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  edgeWalls?: Set<string> | string[],
): boolean {
  if (edgeWalls) {
    const edges = edgeWalls instanceof Set ? edgeWalls : new Set(edgeWalls);
    for (const key of edges) {
      if (edgeIntersectsRay(key, r1, c1, r2, c2)) return false;
    }
  }

  const dx = Math.abs(c2 - c1);
  const dy = Math.abs(r2 - r1);
  const sx = c1 < c2 ? 1 : -1;
  const sy = r1 < r2 ? 1 : -1;
  let err = dx - dy;
  let cx = c1;
  let cr = r1;
  const rows = walls.length;
  const cols = walls[0]?.length ?? 0;

  let steps = 0;
  while (steps++ < 200) {
    if (cx === c2 && cr === r2) return true;
    if (inBounds(cr, cx, rows, cols) && walls[cr][cx]) return false;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cr += sy;
    }
  }
  return false;
}

/**
 * Células que um observador em `origin` enxerga, dado um raio e as paredes.
 * Usado para o fog por jogador (Fase 3) e para `fog:discover`.
 */
export function visibleCellsFrom(
  walls: boolean[][],
  origin: Cell,
  vision: number,
  rows: number,
  cols: number,
  edgeWalls?: Set<string> | string[],
): Cell[] {
  const out: Cell[] = [];
  const vr = vision;
  const r0 = Math.max(0, origin.row - vr);
  const r1 = Math.min(rows - 1, origin.row + vr);
  const c0 = Math.max(0, origin.col - vr);
  const c1 = Math.min(cols - 1, origin.col + vr);

  const edges = edgeWalls ? (edgeWalls instanceof Set ? edgeWalls : new Set(edgeWalls)) : undefined;

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const dist = Math.hypot(r - origin.row, c - origin.col);
      if (dist <= vr && hasLOS(walls, origin.row, origin.col, r, c, edges)) {
        out.push({ row: r, col: c });
      }
    }
  }
  return out;
}

/**
 * Recalcula o fog para uma lista de atores (visão compartilhada).
 *
 * Regra: o que estava VIS agora vira SEEN; depois os atores marcam o que
 * enxergam como VIS. Idempotente — pode ser chamada sempre.
 *
 * Fase 1: recebe todos os atores (visão única). Fase 3: receberá só os
 * atores daquele jogador, mantendo `fogExplored` separado.
 */
export function computeVision(
  fog: FogValue[][],
  walls: boolean[][],
  actors: { row: number; col: number; vision: number }[],
  rows: number,
  cols: number,
  edgeWalls?: Set<string> | string[],
): FogValue[][] {
  const next = fog.map((row) =>
    row.map((v) => (v === FOG_VIS ? FOG_SEEN : v) as FogValue),
  );

  const edges = edgeWalls ? (edgeWalls instanceof Set ? edgeWalls : new Set(edgeWalls)) : undefined;

  for (const a of actors) {
    const vision = a.vision ?? 5;
    const r0 = Math.max(0, a.row - vision);
    const r1 = Math.min(rows - 1, a.row + vision);
    const c0 = Math.max(0, a.col - vision);
    const c1 = Math.min(cols - 1, a.col + vision);

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dist = Math.hypot(r - a.row, c - a.col);
        if (dist <= vision && hasLOS(walls, a.row, a.col, r, c, edges)) {
          next[r][c] = FOG_VIS;
        }
      }
    }
  }
  return next;
}

/** Fusão de células já exploradas — base do `fog:merge` (Fase 2/3). */
export function mergeExplored(
  fog: FogValue[][],
  cells: Cell[],
  value: FogValue = FOG_SEEN,
): FogValue[][] {
  const next = fog.map((row) => row.slice());
  for (const { row, col } of cells) {
    if (next[row]?.[col] === FOG_NONE) next[row][col] = value;
  }
  return next;
}
