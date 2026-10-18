import { FOG_NONE } from "./constants";
import type { FogValue } from "./types";

/** Cria uma grade `rows × cols` preenchida com `val`. */
export function makeGrid<T>(rows: number, cols: number, val: T): T[][] {
  return Array.from({ length: rows }, () => new Array<T>(cols).fill(val));
}

export function makeFog(rows: number, cols: number): FogValue[][] {
  return makeGrid<FogValue>(rows, cols, FOG_NONE);
}

export function makeWalls(rows: number, cols: number): boolean[][] {
  return makeGrid<boolean>(rows, cols, false);
}

/** Cópia rasa de cada linha — seguro para mutação célula a célula. */
export function cloneGrid<T>(g: T[][]): T[][] {
  return g.map((row) => row.slice());
}

/**
 * Redimensiona preservando o conteúdo que couber no novo tamanho.
 * Usado quando o mestre muda colunas/linhas.
 */
export function resizeGrid<T>(
  prev: T[][],
  rows: number,
  cols: number,
  fill: T,
): T[][] {
  const next = makeGrid(rows, cols, fill);
  for (let r = 0; r < Math.min(prev.length, rows); r++) {
    const src = prev[r];
    for (let c = 0; c < Math.min(src?.length ?? 0, cols); c++) {
      next[r][c] = src[c];
    }
  }
  return next;
}

export function inBounds(row: number, col: number, rows: number, cols: number): boolean {
  return row >= 0 && row < rows && col >= 0 && col < cols;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
