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

/**
 * Estado de uma célula no fog.
 *  0 = nunca visto · 1 = já explorado (escuro) · 2 = visível agora
 *  3 = revelado pelo mestre (permanente, nunca volta a escurecer)
 */
export type FogValue = 0 | 1 | 2 | 3;

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
  /** Ficha de atributos livre (chave-valor). Dono do ator ou GM escrevem. */
  sheet?: Record<string, string | number>;
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
export type WallDisplayMode = "blocks" | "thin" | "invisible";

export type Tool =
  | "move"
  | "wall"
  | "wall_edge"
  | "wall_window"
  | "erase"
  | "reveal"
  | "hide"
  | "sector";

/** Configuração da cena (dimensões, fundo, estilo de névoa e alinhamento). */
export interface SceneConfig {
  cols: number;
  rows: number;
  cell: number;
  offsetX?: number;
  offsetY?: number;
  bgImage: string | null;
  fogMode: FogMode;
}

/**
 * Fotografia completa do estado de jogo — o que viaja na rede na Fase 2
 * (na rede, `fog`/`walls` vão comprimidos; ver docs/ARQUITETURA.md).
 */
/** Handout (documento/pista) entregue pelo mestre a jogadores específicos. */
export interface Handout {
  id: string;
  title: string;
  content: string;
  /** IDs dos jogadores que podem ver este handout. */
  to: string[];
}

/** Ordem de turno da mesa. */
export interface Initiative {
  /** IDs dos atores na ordem de turno. */
  order: string[];
  /** Índice do ator cuja vez é agora. */
  currentIndex: number;
}

/** Mensagem de chat trocada na sala. */
export interface ChatMessage {
  id: string;
  author: string;
  role: Role;
  text: string;
  createdAt: number;
}

export interface GameSnapshot extends SceneConfig {
  fog: FogValue[][];
  walls: boolean[][];
  /** Paredes em arestas/bordas (bloqueia movimento e visão): "r,c,h" ou "r,c,v" */
  edgeWalls?: string[];
  /** Janelas/grades em arestas (bloqueia movimento MAS permite visão): "r,c,h" ou "r,c,v" */
  edgeWindows?: string[];
  actors: Actor[];
  sectors: Sector[];
}
