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
  edgeWindows?: Set<string> | string[] | undefined,
): boolean {
  if (!edgeWalls && !edgeWindows) return false;
  const setW = edgeWalls ? (edgeWalls instanceof Set ? edgeWalls : new Set(edgeWalls)) : null;
  const setWin = edgeWindows ? (edgeWindows instanceof Set ? edgeWindows : new Set(edgeWindows)) : null;
  const dr = to.row - from.row;
  const dc = to.col - from.col;

  let key = "";
  if (dr === -1 && dc === 0) {
    // movendo para cima (norte): cruza borda horizontal norte de `from` (row, col, 'h')
    key = `${from.row},${from.col},h`;
  } else if (dr === 1 && dc === 0) {
    // movendo para baixo (sul): cruza borda horizontal norte de `to` (to.row, to.col, 'h')
    key = `${to.row},${to.col},h`;
  } else if (dr === 0 && dc === -1) {
    // movendo para esquerda (oeste): cruza borda vertical oeste de `from` (row, col, 'v')
    key = `${from.row},${from.col},v`;
  } else if (dr === 0 && dc === 1) {
    // movendo para direita (leste): cruza borda vertical oeste de `to` (to.row, to.col, 'v')
    key = `${to.row},${to.col},v`;
  }

  if (!key) return false;
  return !!((setW && setW.has(key)) || (setWin && setWin.has(key)));
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
  edgeWindows?: Set<string> | string[],
): Cell[] | null {
  if (sameCell(start, goal)) return [];

  const blocked = (r: number, c: number) =>
    r < 0 || r >= rows || c < 0 || c >= cols || !!walls[r]?.[c];

  if (blocked(goal.row, goal.col)) return null;

  const edges = edgeWalls ? (edgeWalls instanceof Set ? edgeWalls : new Set(edgeWalls)) : null;
  const windows = edgeWindows ? (edgeWindows instanceof Set ? edgeWindows : new Set(edgeWindows)) : null;

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
      if (isEdgeBlocked(edges ?? undefined, cur, { row: nr, col: nc }, windows ?? undefined)) continue;
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
