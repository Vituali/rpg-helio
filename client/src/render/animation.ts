import { WALK_SPEED } from "../game/constants";
import { facingBetween } from "../game/pathfinding";
import type { Actor, Cell, Facing } from "../game/types";

/**
 * Animação dos atores.
 *
 * Cada ator tem DUAS posições (docs/DECISOES.md #5):
 *
 *   - lógica   → `actor.row/col`, inteira, autoritativa (servidor na Fase 2)
 *   - render   → `anim.rx/ry`, float, local, persegue a lógica a cada frame
 *
 * É isso que faz o sprite ANDAR em vez de teleportar quando o estado muda.
 */

export interface Anim {
  /** Posição renderizada, em unidades de célula (float). */
  rx: number;
  ry: number;
  facing: Facing;
  /** Segundos acumulados andando — dirige o frame do sprite. */
  walkT: number;
  moving: boolean;
}

export type AnimMap = Map<string, Anim>;

/**
 * Avança a animação de todos os atores em direção ao alvo (próximo waypoint
 * do `path`, ou a própria célula lógica se a fila está vazia).
 *
 * Retorna os ids que **chegaram** numa célula — o chamador deve então
 * confirmar o passo (`advanceActor` no cliente; na Fase 2, `intent-move`).
 */
export function stepAnimations(
  anims: AnimMap,
  actors: Actor[],
  dt: number,
): string[] {
  const arrived: string[] = [];

  // Remove animações de atores que sumiram
  const alive = new Set(actors.map((a) => a.id));
  for (const key of anims.keys()) if (!alive.has(key)) anims.delete(key);

  for (const actor of actors) {
    let anim = anims.get(actor.id);
    if (!anim) {
      anim = {
        rx: actor.col,
        ry: actor.row,
        facing: actor.facing,
        walkT: 0,
        moving: false,
      };
      anims.set(actor.id, anim);
    }

    const target: Cell =
      actor.path.length > 0
        ? actor.path[0]
        : { row: actor.row, col: actor.col };

    const dx = target.col - anim.rx;
    const dy = target.row - anim.ry;
    const dist = Math.hypot(dx, dy);

    if (dist < 1e-4) {
      anim.rx = target.col;
      anim.ry = target.row;

      if (actor.path.length > 0) {
        // Chegou no waypoint: confirma o passo (o caminho encolhe).
        arrived.push(actor.id);
        anim.moving = true;
      } else {
        anim.moving = false;
        anim.walkT = 0;
        anim.facing = actor.facing;
      }
      continue;
    }

    anim.moving = true;
    anim.facing = facingBetween({ row: anim.ry, col: anim.rx }, target);

    const step = WALK_SPEED * dt;
    if (step >= dist) {
      anim.rx = target.col;
      anim.ry = target.row;
    } else {
      anim.rx += (dx / dist) * step;
      anim.ry += (dy / dist) * step;
    }
    anim.walkT += dt;
  }

  return arrived;
}
