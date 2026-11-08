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
  /** Se o ator tem movimento liberado (para mostrar badge/cadeado se travado) */
  canMove?: boolean;
}


export function drawActor(
  ctx: CanvasRenderingContext2D,
  _sheet: SpriteSheet,
  p: ActorDraw,
): void {
  const bodyR = p.cell * 0.44;

  // Sombra suave no chão
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(
    p.cx,
    p.cy + bodyR * 0.82,
    bodyR * 0.85,
    bodyR * 0.28,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  if (p.portrait) {
    drawToken(ctx, p.portrait, p, bodyR);
  } else {
    drawTokenFallback(ctx, p, bodyR);
  }

  // Apenas 1 anel ao redor do token: Dourado quando selecionado, ou anel sutil do token se não selecionado
  if (p.active) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, bodyR + 2.5, 0, Math.PI * 2);
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  // Placa de nome estilizada + Indicador se travado
  ctx.save();
  const fontSize = Math.max(9, Math.round(p.cell * 0.21));
  ctx.font = `600 ${fontSize}px 'Chakra Petch', sans-serif`;
  const isLocked = p.canMove === false;
  const labelWithLock = isLocked ? `🔒 ${p.label}` : p.label;
  const textW = ctx.measureText(labelWithLock).width;
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
  ctx.fillStyle = isLocked ? "rgba(35, 10, 10, 0.88)" : "rgba(8, 5, 16, 0.82)";
  ctx.fill();
  ctx.strokeStyle = isLocked
    ? "rgba(239, 68, 68, 0.65)"
    : p.active
      ? "rgba(251, 191, 36, 0.65)"
      : "rgba(168, 85, 247, 0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = isLocked ? "#fca5a5" : p.active ? "#fef3c7" : "#f3effb";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(labelWithLock, p.cx, boxY + padY);
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

  // Borda única do token na cor do ator
  ctx.beginPath();
  ctx.arc(p.cx, p.cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = p.color;
  ctx.lineWidth = Math.max(1.8, r * 0.08);
  ctx.stroke();
}

/**
 * Token procedural circular quando não há retrato em imagem.
 * Mantém o formato idêntico de token circular.
 */
function drawTokenFallback(
  ctx: CanvasRenderingContext2D,
  p: ActorDraw,
  r: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.cx, p.cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(20, 12, 36, 0.95)";
  ctx.fill();
  ctx.strokeStyle = p.color;
  ctx.lineWidth = Math.max(1.8, r * 0.08);
  ctx.stroke();

  // Sigilo inicial com as 2 primeiras letras
  ctx.fillStyle = p.color;
  ctx.font = `700 ${Math.round(r * 0.72)}px 'Cinzel', Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(p.label.slice(0, 2).toUpperCase(), p.cx, p.cy);
  ctx.restore();
}
