import type { Cell, Facing } from "./types";

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], // cima
  [1, 0],  // baixo
  [0, -1], // esquerda
  [0, 1],  // direita
];

/** Direção cardinal de `from` para `to` (aproximada ao eixo dominante). */
export function facingBetween(from: Cell, to: Cell): Facing {
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  if (Math.abs(dc) > Math.abs(dr)) return dc < 0 ? "w" : "e";
  if (dr !== 0) return dr < 0 ? "n" : "s";
  return "e";
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.row === b.row && a.col === b.col;
}

export function isAdjacent(a: Cell, b: Cell): boolean {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

export function isEdgeBlocked(
  edgeWalls: Set<string> | string[] | undefined,
  from: Cell,
  to: Cell,
): boolean {
  if (!edgeWalls) return false;
  const set = edgeWalls instanceof Set ? edgeWalls : new Set(edgeWalls);
  const dr = to.row - from.row;
  const dc = to.col - from.col;

  if (dr === -1 && dc === 0) {
    // movendo para cima (norte): cruza borda horizontal norte de `from` (row, col, 'h')
    return set.has(`${from.row},${from.col},h`);
  }
  if (dr === 1 && dc === 0) {
    // movendo para baixo (sul): cruza borda horizontal norte de `to` (to.row, to.col, 'h')
    return set.has(`${to.row},${to.col},h`);
  }
  if (dr === 0 && dc === -1) {
    // movendo para esquerda (oeste): cruza borda vertical oeste de `from` (row, col, 'v')
    return set.has(`${from.row},${from.col},v`);
  }
  if (dr === 0 && dc === 1) {
    // movendo para direita (leste): cruza borda vertical oeste de `to` (to.row, to.col, 'v')
    return set.has(`${to.row},${to.col},v`);
  }
  return false;
}

/**
 * BFS ortogonal (4 direções), primeiro caminho mais curto.
 * Retorna o caminho SEM incluir a célula de origem, ou `null` se inalcançável.
 *
 * Usado no cliente para predição e, na Fase 2, o servidor valida cada passo
 * com a MESMA checagem de parede/limite (docs/ARQUITETURA.md).
 */
export function findPath(
  walls: boolean[][],
  start: Cell,
  goal: Cell,
  rows: number,
  cols: number,
  edgeWalls?: Set<string> | string[],
): Cell[] | null {
  if (sameCell(start, goal)) return [];

  const blocked = (r: number, c: number) =>
    r < 0 || r >= rows || c < 0 || c >= cols || !!walls[r]?.[c];

  if (blocked(goal.row, goal.col)) return null;

  const edges = edgeWalls ? (edgeWalls instanceof Set ? edgeWalls : new Set(edgeWalls)) : null;

  const key = (r: number, c: number) => r * cols + c;
  const startKey = key(start.row, start.col);
  const goalKey = key(goal.row, goal.col);

  const prev = new Map<number, number>();
  const seen = new Set<number>([startKey]);
  const queue: Cell[] = [start];
  let head = 0;
  let found = false;

  while (head < queue.length) {
    const cur = queue[head++];
    if (cur.row === goal.row && cur.col === goal.col) {
      found = true;
      break;
    }
    for (const [dr, dc] of DIRS) {
      const nr = cur.row + dr;
      const nc = cur.col + dc;
      if (blocked(nr, nc)) continue;
      if (edges && isEdgeBlocked(edges, cur, { row: nr, col: nc })) continue;
      const k = key(nr, nc);
      if (seen.has(k)) continue;
      seen.add(k);
      prev.set(k, key(cur.row, cur.col));
      queue.push({ row: nr, col: nc });
    }
  }

  if (!found) return null;

  const path: Cell[] = [];
  let k = goalKey;
  while (k !== startKey) {
    path.push({ row: Math.floor(k / cols), col: k % cols });
    const p = prev.get(k);
    if (p === undefined) return null;
    k = p;
  }
  return path.reverse();
}
