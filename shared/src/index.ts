/**
 * @helio/shared — regras puras do jogo.
 *
 * Sem React, sem canvas, sem socket. Usado pelo cliente (predição e desenho)
 * e pelo servidor (autoridade). Uma implementação só, duas execuções.
 * Ver docs/DECISOES.md #4.
 */

export type * from "./types";
export * from "./constants";
export * from "./grid";
export * from "./vision";
export * from "./pathfinding";
export * from "./id";
export * from "./lib/dice";
