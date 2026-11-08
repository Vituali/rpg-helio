/**
 * Adapter de rede — Socket.IO (docs/DECISOES.md #2).
 *
 * Responsabilidades:
 *  - conectar e entrar na sala;
 *  - aplicar o estado autoritativo do servidor no gameStore;
 *  - transmitir intenções (o store chama via `net/bridge.ts`);
 *  - desfazer a predição local quando o servidor recusa um movimento.
 *
 * Trocar de transporte (Colyseus, WebRTC) significa reescrever só este arquivo.
 */

import { io, type Socket } from "socket.io-client";
import { FOG_NONE, FOG_VIS } from "@helio/shared";
import type { Cell } from "@helio/shared";
import { useGameStore, type ServerScene } from "../state/gameStore";
import { flashNotice, useNetStore, type NetPlayer } from "../state/netStore";
import { setSender } from "./bridge";

export interface ServerState {
  ok?: boolean;
  /** Preenchido quando o servidor recusa a entrada (ex.: senha de mestre errada). */
  error?: string;
  code: string;
  /** Nome humano da missão (ADR #18). */
  name: string;
  you: string;
  scene: ServerScene;
  players: NetPlayer[];
}

let socket: Socket | null = null;

/** Última posição que o servidor confirmou, por ator — usada para desfazer predição. */
const confirmed = new Map<string, Cell>();

/** Células de fog já avisadas ao servidor (para não repetir a cada passo). */
const reportedFog = new Set<string>();

export interface JoinOptions {
  code: string;
  /**
   * Senha de mestre — a escapatória legada (ADRs #19/#20). Só importa quando o
   * servidor define `GM_KEY`; sem ela, o papel vem do vínculo e isto fica vazio.
   */
  key: string;
}

export function connect(opts: JoinOptions): void {
  disconnect();
  const url = useNetStore.getState().serverUrl;

  const net = () => useNetStore.getState();
  net().setStatus("connecting");
  net().setNotice(null);

  const s = io(url.trim() || undefined, {
    transports: ["websocket", "polling"],
    // O cookie de sessão vai no handshake (ADR #16): é assim que o servidor já
    // sabe com quem está falando, sem mensagem de login no meio do jogo.
    withCredentials: true,
  });
  socket = s;

  s.on("connect", () => {
    // O cliente não pede papel nem manda nome: o servidor sabe quem entrou pelo
    // cookie e decide o papel pelo vínculo (ADR #20).
    s.emit("room:join", { code: opts.code, key: opts.key }, (state: ServerState) => {
      if (state?.ok) {
        applyState(state);
        return;
      }
      // Entrada recusada (conta exigida, senha de mestre errada, selo
      // desconhecido): volta à escolha da missão com o motivo, em vez de ficar
      // um cliente conectado que não está na sala.
      flashNotice(state?.error ?? "O servidor recusou a entrada.");
      net().setStatus("offline");
      disconnect();
    });
  });

  s.on("connect_error", (err: Error) => {
    net().setStatus("offline");
    net().setNotice(
      `Não foi possível conectar em "${url || "mesma origem"}": ${err.message}`,
    );
  });

  s.on("room:state", (state: ServerState) => applyState(state));

  s.on("error", (e: { code?: string; msg?: string; actorId?: string }) => {
    flashNotice(e?.msg ?? "Ação recusada pelo servidor.");
    if (e?.code === "MOVE_DENIED" && e.actorId) {
      const at = confirmed.get(e.actorId) ?? null;
      useGameStore.getState().snapActorTo(e.actorId, at);
    }
  });

  s.on("disconnect", () => {
    setSender(null);
    useNetStore.getState().reset();
    useNetStore.getState().setNotice("Desconectado do servidor.");
  });
}

export function disconnect(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  setSender(null);
  confirmed.clear();
  reportedFog.clear();
}

// ── Interno ──────────────────────────────────────────────────────────────────
function sendIntent(event: string, payload: unknown): void {
  socket?.emit(event, payload);
}

function applyState(state: ServerState): void {
  if (!state?.scene) return;

  const game = useGameStore.getState();
  game.applyServerScene(state.scene);

  for (const a of state.scene.actors) {
    confirmed.set(a.id, { row: a.row, col: a.col });
  }

  // Célula que o mestre escondeu volta a poder ser reportada depois.
  for (const key of [...reportedFog]) {
    const [r, c] = key.split(",").map(Number);
    if (state.scene.fogExplored[r]?.[c] === FOG_NONE) reportedFog.delete(key);
  }

  const me = state.players.find((p) => p.id === state.you);
  game.setGmMode(me?.role === "gm");

  const store = useNetStore.getState();
  store.setRoom({
    code: state.code,
    mission: state.name,
    you: state.you,
    role: me?.role ?? "player",
    players: state.players,
  });
  store.setStatus("online");

  setSender(sendIntent);
  reportNewFog();
}

/** Conta ao servidor o que o token do jogador passou a enxergar. */
function reportNewFog(): void {
  const { visibleNow } = useGameStore.getState();
  const fresh: Cell[] = [];
  for (let r = 0; r < visibleNow.length; r += 1) {
    const row = visibleNow[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c += 1) {
      if (row[c] !== FOG_VIS) continue;
      const key = `${r},${c}`;
      if (!reportedFog.has(key)) {
        reportedFog.add(key);
        fresh.push({ row: r, col: c });
      }
    }
  }
  if (fresh.length > 0) sendIntent("fog:discover", { cells: fresh });
}
