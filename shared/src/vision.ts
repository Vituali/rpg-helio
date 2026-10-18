import { FOG_NONE, FOG_SEEN, FOG_VIS } from "./constants";
import { inBounds } from "./grid";
import type { Cell, FogValue } from "./types";

/**
 * Line of Sight por Bresenham: há visão de (r1,c1) para (r2,c2) se nenhuma
 * parede bloquear o caminho entre os centros das células.
 */
export function hasLOS(
  walls: boolean[][],
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): boolean {
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
): Cell[] {
  const out: Cell[] = [];
  const vr = vision;
  const r0 = Math.max(0, origin.row - vr);
  const r1 = Math.min(rows - 1, origin.row + vr);
  const c0 = Math.max(0, origin.col - vr);
  const c1 = Math.min(cols - 1, origin.col + vr);

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const dist = Math.hypot(r - origin.row, c - origin.col);
      if (dist <= vr && hasLOS(walls, origin.row, origin.col, r, c)) {
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
): FogValue[][] {
  const next = fog.map((row) =>
    row.map((v) => (v === FOG_VIS ? FOG_SEEN : v) as FogValue),
  );

  for (const a of actors) {
    const vision = a.vision ?? 5;
    const r0 = Math.max(0, a.row - vision);
    const r1 = Math.min(rows - 1, a.row + vision);
    const c0 = Math.max(0, a.col - vision);
    const c1 = Math.min(cols - 1, a.col + vision);

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dist = Math.hypot(r - a.row, c - a.col);
        if (dist <= vision && hasLOS(walls, a.row, a.col, r, c)) {
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
