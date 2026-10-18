import { create } from "zustand";
import type { Role } from "@helio/shared";

/**
 * Estado da conexão — separado do estado do jogo.
 *
 * Aqui mora só o que é da rede: quem está na sala, quem é você, se está
 * conectado. A cena (mapa, atores, fog) continua em `gameStore`, porque é ela
 * que o canvas desenha. Ver docs/DECISOES.md #3.
 */

export interface NetPlayer {
  id: string;
  name: string;
  role: Role;
  actorId: string | null;
  canMoveGlobal: boolean;
}

export type NetStatus = "offline" | "connecting" | "online";

export interface NetState {
  status: NetStatus;
  code: string | null;
  /** Nome humano da missão (ADR #18). O selo é o convite; isto é o que se lê. */
  mission: string | null;
  you: string | null;
  role: Role | null;
  players: NetPlayer[];
  /** Último aviso do servidor (ex.: "movimento negado"). Some sozinho. */
  notice: string | null;
  /** Último endereço usado, para o botão de reconectar. */
  serverUrl: string;

  setStatus: (status: NetStatus) => void;
  setRoom: (room: {
    code: string;
    mission: string;
    you: string;
    role: Role;
    players: NetPlayer[];
  }) => void;
  setPlayers: (players: NetPlayer[]) => void;
  setNotice: (notice: string | null) => void;
  setServerUrl: (url: string) => void;
  reset: () => void;
}

export const useNetStore = create<NetState>()((set) => ({
  status: "offline",
  code: null,
  mission: null,
  you: null,
  role: null,
  players: [],
  notice: null,
  serverUrl: "",

  setStatus: (status) => set({ status }),
  setRoom: ({ code, mission, you, role, players }) =>
    set({ code, mission, you, role, players }),
  setPlayers: (players) => set({ players }),
  setNotice: (notice) => set({ notice }),
  setServerUrl: (serverUrl) => set({ serverUrl }),
  reset: () =>
    set({
      status: "offline",
      code: null,
      mission: null,
      you: null,
      role: null,
      players: [],
      notice: null,
    }),
}));

export const isGm = (s: NetState): boolean => s.role === "gm";
