import { WALK_FPS } from "@helio/shared";
import type { Facing } from "@helio/shared";

/**
 * Sprites dos atores.
 *
 * Suporta DOIS modos, com o mesmo código de animação:
 *
 *  1. Arte real — carrega `/sprites/<key>.png`, organizado em 4 linhas
 *     (direções) × N colunas (frames de caminhada):
 *
 *         col 0   col 1   col 2   col 3
 *         ┌───────┬───────┬───────┬───────┐
 *    S    │       │       │       │       │   linha 0
 *    W    │       │       │       │       │   linha 1
 *    E    │       │       │       │       │   linha 2
 *    N    │       │       │       │       │   linha 3
 *         └───────┴───────┴───────┴───────┘
 *
 *  2. Fallback procedural — se o PNG não existir, desenha um humanóide
 *     com pernas que alternam. O jogo roda sem nenhum asset e ganha arte
 *     só soltando o arquivo na pasta (docs/DECISOES.md #7).
 */

export interface SpriteSheet {
  key: string;
  image: HTMLImageElement | null;
  frameW: number;
  frameH: number;
  /** Frames de caminhada por direção. */
  cols: number;
}

/** Ordem das linhas no spritesheet. */
const DIRECTION_ROW: Record<Facing, number> = { s: 0, w: 1, e: 2, n: 3 };

/** Deslocamento do rosto, para o ator "olhar" na direção certa. */
const FACING_VEC: Record<Facing, { x: number; y: number }> = {
  n: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
  e: { x: 1, y: 0 },
};

const cache = new Map<string, SpriteSheet>();

/**
 * Carrega (uma vez) o spritesheet de uma chave. Se o arquivo não existir,
 * o `image` fica `null` e o desenhador cai no modo procedural.
 */
export function getSheet(
  key: string,
  opts: { frameW?: number; frameH?: number; cols?: number } = {},
): SpriteSheet {
  const existing = cache.get(key);
  if (existing) return existing;

  const sheet: SpriteSheet = {
    key,
    image: null,
    frameW: opts.frameW ?? 32,
    frameH: opts.frameH ?? 32,
    cols: opts.cols ?? 4,
  };
  cache.set(key, sheet);

  const img = new Image();
  img.onload = () => {
    sheet.image = img;
  };
  img.onerror = () => {
    // Sem arte → modo procedural. Nada a fazer.
  };
  img.src = `/sprites/${key}.png`;

  return sheet;
}

/** Retângulo arredondado (compatível sem depender de `ctx.roundRect`). */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export interface ActorDraw {
  /** Centro do ator, em px do mundo (já sob a transformação de pan/zoom). */
  cx: number;
  cy: number;
  cell: number;
  color: string;
  facing: Facing;
  /** Segundos acumulados andando — dirige o frame. */
  walkT: number;
  moving: boolean;
  active: boolean;
  label: string;
  /** Retrato estático (modo token). Tem prioridade sobre o spritesheet. */
  portrait?: HTMLImageElement | null;
}

export function drawActor(
  ctx: CanvasRenderingContext2D,
  sheet: SpriteSheet,
  p: ActorDraw,
): void {
  const proceduralR = p.cell * 0.32;
  const bodyR = p.portrait ? p.cell * 0.46 : proceduralR;

  // Sombra no chão
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(
    p.cx,
    p.cy + bodyR * 0.82,
    bodyR * 0.85,
    bodyR * (p.portrait ? 0.28 : 0.34),
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  if (p.portrait) {
    drawToken(ctx, p.portrait, p, bodyR);
  } else if (sheet.image) {
    drawSheet(ctx, sheet, p);
  } else {
    drawProcedural(ctx, p, proceduralR);
  }

  // Anel ritualístico do ator selecionado
  if (p.active) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, bodyR * 1.24, 0, Math.PI * 2);
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(p.cx, p.cy, bodyR * 1.12, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(192, 132, 252, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();
  }

  // Placa de nome estilizada
  ctx.save();
  const fontSize = Math.max(9, Math.round(p.cell * 0.21));
  ctx.font = `600 ${fontSize}px 'Chakra Petch', sans-serif`;
  const textW = ctx.measureText(p.label).width;
  const padX = 5;
  const padY = 2;
  const boxY = p.cy + bodyR * 1.1;
  roundRect(
    ctx,
    p.cx - textW / 2 - padX,
    boxY,
    textW + padX * 2,
    fontSize + padY * 2,
    4,
  );
  ctx.fillStyle = "rgba(8, 5, 16, 0.82)";
  ctx.fill();
  ctx.strokeStyle = p.active ? "rgba(251, 191, 36, 0.65)" : "rgba(168, 85, 247, 0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = p.active ? "#fef3c7" : "#f3effb";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(p.label, p.cx, boxY + padY);
  ctx.restore();
}

/**
 * Modo token: retrato recortado num círculo com anel na cor do dono.
 * É o visual clássico de VTT — o retrato DESLIZA entre as casas (o movimento
 * suave vem da interpolação, não de uma animação de pernas).
 * O arquivo já vem quadrado (ver tools/optimize-assets.ps1), então não distorce.
 */
function drawToken(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  p: ActorDraw,
  r: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.cx, p.cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, p.cx - r, p.cy - r, r * 2, r * 2);
  ctx.restore();

  // Anel na cor do dono
  ctx.beginPath();
  ctx.arc(p.cx, p.cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = p.color;
  ctx.lineWidth = Math.max(2, r * 0.14);
  ctx.stroke();

  // Brilho interno, dá profundidade
  ctx.beginPath();
  ctx.arc(p.cx, p.cy, r, Math.PI, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.stroke();
}

function drawSheet(
  ctx: CanvasRenderingContext2D,
  sheet: SpriteSheet,
  p: ActorDraw,
): void {
  const img = sheet.image;
  if (!img) return;

  const frame = p.moving ? Math.floor(p.walkT * WALK_FPS) % sheet.cols : 0;
  const row = DIRECTION_ROW[p.facing];

  const dw = p.cell * 1.1;
  const dh = p.cell * 1.1;
  ctx.drawImage(
    img,
    frame * sheet.frameW,
    row * sheet.frameH,
    sheet.frameW,
    sheet.frameH,
    p.cx - dw / 2,
    p.cy - dh * 0.72,
    dw,
    dh,
  );
}

function drawProcedural(
  ctx: CanvasRenderingContext2D,
  p: ActorDraw,
  r: number,
): void {
  const swing = p.moving ? Math.sin(p.walkT * 12) * r * 0.5 : 0;
  const bob = p.moving ? Math.abs(Math.sin(p.walkT * 12)) * r * 0.08 : 0;
  const cy = p.cy - bob;
  const dir = FACING_VEC[p.facing];

  // Pernas
  ctx.fillStyle = "#1f1733";
  const legW = r * 0.34;
  const legH = r * 0.75;
  roundRect(ctx, p.cx - r * 0.5 + swing, cy + r * 0.05, legW, legH, legW * 0.4);
  ctx.fill();
  roundRect(ctx, p.cx + r * 0.16 - swing, cy + r * 0.05, legW, legH, legW * 0.4);
  ctx.fill();

  // Corpo
  roundRect(ctx, p.cx - r * 0.62, cy - r * 0.55, r * 1.24, r * 1.15, r * 0.4);
  ctx.fillStyle = p.color;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Cabeça
  ctx.beginPath();
  ctx.arc(p.cx, cy - r * 0.95, r * 0.48, 0, Math.PI * 2);
  ctx.fillStyle = "#e8e3ff";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.stroke();

  // Olhos, apontando para a direção encarada
  const ex = dir.x * r * 0.16;
  const ey = dir.y * r * 0.16;
  const perp = { x: -dir.y, y: dir.x };
  ctx.fillStyle = "#2a1f45";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(
      p.cx + ex + perp.x * r * 0.16 * s,
      cy - r * 0.95 + ey + perp.y * r * 0.16 * s,
      r * 0.075,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}
