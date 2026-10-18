import { isAdjacent } from "@helio/shared";
import type { Cell } from "@helio/shared";
import type { Player, Room } from "./room.js";

/**
 * Validação de intenções. Roda SÓ no servidor — o cliente pede, o servidor
 * decide. As regras puras vêm de `@helio/shared`, a mesma implementação que o
 * cliente usa para predição (docs/DECISOES.md #4).
 */

export interface Verdict {
  ok: boolean;
  reason?: string;
}

export function canMove(
  room: Room,
  player: Player,
  actorId: string,
  to: Cell,
): Verdict {
  const actor = room.scene.actors.find((a) => a.id === actorId);
  if (!actor) return { ok: false, reason: "Ator não existe." };

  const isGm = player.role === "gm";
  const isOwner = actor.ownerId === player.id;

  if (!isGm && !isOwner) return { ok: false, reason: "Este ator não é seu." };

  if (!isGm && !(player.canMoveGlobal || actor.canMove)) {
    return { ok: false, reason: "O mestre ainda não liberou seu movimento." };
  }

  const { rows, cols, walls } = room.scene;
  if (to.row < 0 || to.row >= rows || to.col < 0 || to.col >= cols) {
    return { ok: false, reason: "Fora do mapa." };
  }
  if (walls[to.row]?.[to.col]) return { ok: false, reason: "Parede." };
  if (!isAdjacent({ row: actor.row, col: actor.col }, to)) {
    return { ok: false, reason: "Um passo por vez." };
  }

  return { ok: true };
}
