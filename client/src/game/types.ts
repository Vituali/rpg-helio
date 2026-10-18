/**
 * Tipos do jogo.
 *
 * Este módulo NÃO importa React, canvas nem socket — de propósito.
 * As mesmas regras rodam no cliente (predição/desenho) e, na Fase 2,
 * no servidor (autoridade). Ver docs/DECISOES.md #4.
 */

export type Role = "gm" | "player";

/** Direção que o ator está encarando (afeta o frame do sprite). */
export type Facing = "n" | "s" | "e" | "w";

export interface Cell {
  row: number;
  col: number;
}

/** 0 = nunca visto · 1 = já visto (escuro) · 2 = visível agora */
export type FogValue = 0 | 1 | 2;

export interface Actor {
  id: string;
  name: string;
  /** Quem controla. `null` = NPC do mestre. */
  ownerId: string | null;
  /** Posição lógica (autoritativa). Só muda quando confirmada. */
  row: number;
  col: number;
  facing: Facing;
  /** Raio de visão em células. */
  vision: number;
  /** Chave do spritesheet em /sprites/<key>.png (com fallback procedural). */
  sprite: string;
  /** Retrato estático em /tokens/*.png (modo token). Tem prioridade sobre `sprite`. */
  portrait: string | null;
  color: string;
  /** Permissão individual de movimento, liberada pelo mestre. */
  canMove: boolean;
  /** Fila de células a percorrer (predição local; o servidor valida cada passo). */
  path: Cell[];
}

export interface Sector {
  id: string;
  name: string;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  color: string;
}

export type FogMode = "soft" | "hard";

export type Tool = "move" | "wall" | "erase" | "reveal" | "hide" | "sector";

/** Configuração da cena (dimensões, fundo, estilo de névoa). */
export interface SceneConfig {
  cols: number;
  rows: number;
  cell: number;
  bgImage: string | null;
  fogMode: FogMode;
}

/**
 * Fotografia completa do estado de jogo — o que viaja na rede na Fase 2
 * (na rede, `fog`/`walls` vão comprimidos; ver docs/ARQUITETURA.md).
 */
export interface GameSnapshot extends SceneConfig {
  fog: FogValue[][];
  walls: boolean[][];
  actors: Actor[];
  sectors: Sector[];
}
