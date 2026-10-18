import {
  DEFAULT_CELL,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  makeFog,
  makeWalls,
} from "@helio/shared";
import type { Actor, FogMode, Role, Sector } from "@helio/shared";

/**
 * Estado autoritativo da cena (servidor).
 *
 * Diferença para o `GameSnapshot` do cliente: aqui NÃO existe `fog` (visão
 * atual de cada jogador) — só `fogExplored`, que é compartilhado e permanente.
 * Cada cliente calcula a própria visão a partir dele. Ver docs/ARQUITETURA.md.
 */
export interface ServerScene {
  cols: number;
  rows: number;
  cell: number;
  bgImage: string | null;
  fogMode: FogMode;
  walls: boolean[][];
  /** 0 = nunca visto · 1 = já explorado (compartilhado, permanente) */
  fogExplored: number[][];
  actors: Actor[];
  sectors: Sector[];
  /** Incrementa a cada mudança autoritativa — base para reconciliar no futuro. */
  version: number;
}

export interface Player {
  id: string;
  name: string;
  role: Role;
  /** Ator que este jogador controla, se houver. */
  actorId: string | null;
  /** Liberação geral do mestre (além do `canMove` por ator). */
  canMoveGlobal: boolean;
}

export interface Room {
  code: string;
  scene: ServerScene;
  players: Map<string, Player>;
}

export function createScene(): ServerScene {
  return {
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cell: DEFAULT_CELL,
    bgImage: null,
    fogMode: "soft",
    walls: makeWalls(DEFAULT_ROWS, DEFAULT_COLS),
    fogExplored: makeFog(DEFAULT_ROWS, DEFAULT_COLS),
    actors: [],
    sectors: [],
    version: 0,
  };
}

export function createRoom(code: string): Room {
  return { code, scene: createScene(), players: new Map() };
}

/** Payload enviado ao cliente: a cena + a lista de jogadores + quem é você. */
export interface PublicState {
  code: string;
  you: string;
  scene: ServerScene;
  players: Player[];
}

export function publicState(room: Room, you: string): PublicState {
  return {
    code: room.code,
    you,
    scene: room.scene,
    players: [...room.players.values()],
  };
}
