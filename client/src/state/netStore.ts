import { create } from "zustand";
import type { Role, ChatMessage } from "@helio/shared";

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

  /** Mensagens de chat da sessão (limpas ao sair da sala). */
  messages: ChatMessage[];

  setStatus: (status: NetStatus) => void;
  setRoom: (room: {
    code: string;
    mission: string;
    you: string;
    role: Role;
    players: NetPlayer[];
  }) => void;
  setPlayers: (players: NetPlayer[]) => void;
  addMessage: (msg: ChatMessage) => void;
  clearMessages: () => void;
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
  messages: [],

  setStatus: (status) => set({ status }),
  setRoom: ({ code, mission, you, role, players }) =>
    set({ code, mission, you, role, players, messages: [] }),
  setPlayers: (players) => set({ players }),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  clearMessages: () => set({ messages: [] }),
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
      messages: [],
    }),
}));

export const isGm = (s: NetState): boolean => s.role === "gm";

/**
 * Aviso que some sozinho.
 *
 * O mesmo texto pode ser reescrito por outra ação enquanto o primeiro ainda está
 * na tela: por isso o `setTimeout` só apaga se o aviso ainda for este.
 */
export function flashNotice(msg: string, ms = 5000): void {
  const store = useNetStore.getState();
  store.setNotice(msg);
  window.setTimeout(() => {
    if (useNetStore.getState().notice === msg) useNetStore.getState().setNotice(null);
  }, ms);
}
