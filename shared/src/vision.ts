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

  // t é o parâmetro ao longo do raio de visão [p0 -> p1] (de 0 a 1).
  // s é o parâmetro ao longo da aresta da parede [p2 -> p3] (de 0 a 1).
  // Se o raio atinge a quina/vértice da aresta (s próximo de 0 ou 1), ele é bloqueado
  // para impedir que a luz vaze pelas frestas dos cantos entre duas arestas que se encontram.
  return t >= 0.001 && t <= 0.999 && s >= -1e-4 && s <= 1 + 1e-4;
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
 * Line of Sight com travessia exata de grade (Amanatides-Woo):
 * Há visão de (r1,c1) para (r2,c2) se nenhuma parede em bloco ou parede de borda
 * bloquear o caminho contínuo entre os centros das células.
 *
 * Ao cruzar exatamente o vértice/canto entre 4 células na diagonal, se qualquer uma
 * das células adjacentes for uma parede sólida, o raio é bloqueado (impedindo vazamento
 * de visão pelos cantos/quinas de paredes em bloco).
 */
export function hasLOS(
  walls: boolean[][],
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  edgeWalls?: Set<string> | string[],
  _edgeWindows?: Set<string> | string[],
): boolean {
  if (r1 === r2 && c1 === c2) return true;

  if (edgeWalls) {
    const edges = edgeWalls instanceof Set ? edgeWalls : new Set(edgeWalls);
    for (const key of edges) {
      if (edgeIntersectsRay(key, r1, c1, r2, c2)) return false;
    }
  }

  // Janelas por aresta bloqueiam movimento, NÃO visão — portanto não entram
  // no cálculo de LOS. São aceitas aqui só para assinatura consistente com
  // o pathfinding (que sim as considera bloqueadoras de movimento).
  void _edgeWindows;

  const rows = walls.length;
  const cols = walls[0]?.length ?? 0;

  const x0 = c1 + 0.5;
  const y0 = r1 + 0.5;
  const x1 = c2 + 0.5;
  const y1 = r2 + 0.5;
  const dx = x1 - x0;
  const dy = y1 - y0;

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

  let currentX = c1;
  let currentY = r1;

  let tMaxX = stepX > 0 ? (currentX + 1 - x0) / dx : stepX < 0 ? (currentX - x0) / dx : Infinity;
  let tMaxY = stepY > 0 ? (currentY + 1 - y0) / dy : stepY < 0 ? (currentY - y0) / dy : Infinity;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;

  let steps = 0;
  while ((currentX !== c2 || currentY !== r2) && steps++ < 300) {
    if (Math.abs(tMaxX - tMaxY) < 1e-6) {
      // O raio cruza exatamente a quina/canto entre 4 células
      const adj1Y = currentY;
      const adj1X = currentX + stepX;
      const adj2Y = currentY + stepY;
      const adj2X = currentX;

      const wall1 = inBounds(adj1Y, adj1X, rows, cols) && walls[adj1Y][adj1X];
      const wall2 = inBounds(adj2Y, adj2X, rows, cols) && walls[adj2Y][adj2X];

      // Se o destino for uma das células adjacentes, podemos vê-la
      if ((adj1Y === r2 && adj1X === c2) || (adj2Y === r2 && adj2X === c2)) {
        // Alcançou o destino
      } else if (wall1 || wall2) {
        // Bloqueado pela quina da parede
        return false;
      }

      currentX += stepX;
      currentY += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    } else if (tMaxX < tMaxY) {
      currentX += stepX;
      tMaxX += tDeltaX;
    } else {
      currentY += stepY;
      tMaxY += tDeltaY;
    }

    if (currentX === c2 && currentY === r2) break;
    if (inBounds(currentY, currentX, rows, cols) && walls[currentY][currentX]) {
      return false;
    }
  }

  return true;
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
  _edgeWindows?: Set<string> | string[],
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
  void _edgeWindows;
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
  _edgeWindows?: Set<string> | string[],
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
  void _edgeWindows;
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
