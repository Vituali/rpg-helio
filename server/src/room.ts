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
  /**
   * Campanha correspondente no banco — o Selo da Missão (ADR #17).
   * `null` quando não há banco configurado, e aí a sala vive só em memória.
   */
  campaignId: string | null;
  scene: ServerScene;
  players: Map<string, Player>;
  /**
   * Tokens criados para jogadores (via `room:join`). NÃO são persistidos: um
   * token de jogador pertence à sessão, e o `ownerId` dele é um socket, que não
   * sobrevive a um restart. Gravar isso seria gravar lixo. Volta a existir
   * quando o jogador entra de novo.
   */
  pcActors: Set<string>;
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

export function createRoom(code: string, campaignId: string | null = null): Room {
  return { code, campaignId, scene: createScene(), players: new Map(), pcActors: new Set() };
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
