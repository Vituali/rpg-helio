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
  offsetX?: number;
  offsetY?: number;
  bgImage: string | null;
  fogMode: FogMode;
  walls: boolean[][];
  /** Paredes em aresta/borda ("r,c,h" ou "r,c,v") */
  edgeWalls?: string[];
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
  /**
   * Conta por trás deste jogador, quando entrou logado (ADR #16). `null` para
   * convidado — e aí a identidade é só do socket, como sempre foi.
   */
  accountId: string | null;
  /** Ator que este jogador controla, se houver. */
  actorId: string | null;
  /** Liberação geral do mestre (além do `canMove` por ator). */
  canMoveGlobal: boolean;
}

export interface Room {
  code: string;
  /**
   * Nome humano da missão (ADR #18). O selo é o convite; isto é o que se lê.
   * Sem banco, é o próprio selo — melhor repetir o código do que mostrar vazio.
   */
  name: string;
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
    offsetX: 0,
    offsetY: 0,
    bgImage: null,
    fogMode: "soft",
    walls: makeWalls(DEFAULT_ROWS, DEFAULT_COLS),
    edgeWalls: [],
    fogExplored: makeFog(DEFAULT_ROWS, DEFAULT_COLS),
    actors: [],
    sectors: [],
    version: 0,
  };
}

export function createRoom(
  code: string,
  campaignId: string | null = null,
  name: string = code,
): Room {
  return {
    code,
    name,
    campaignId,
    scene: createScene(),
    players: new Map(),
    pcActors: new Set(),
  };
}

/** Payload enviado ao cliente: a cena + a lista de jogadores + quem é você. */
export interface PublicState {
  code: string;
  /** Nome humano da missão, para o cabeçalho não mostrar só o selo. */
  name: string;
  you: string;
  scene: ServerScene;
  players: Player[];
}

export function publicState(room: Room, you: string): PublicState {
  return {
    code: room.code,
    name: room.name,
    you,
    scene: room.scene,
    players: [...room.players.values()],
  };
}
