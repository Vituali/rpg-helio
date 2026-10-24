/**
 * Ponte entre o CRUD (HTTP) e a mesa viva (Socket.IO).
 *
 * Promover alguém a mestre é um ato administrativo: grava um vínculo no banco e
 * passa pelas rotas de campanha (ADR #22). Mas o efeito é **agora** — se o papel
 * só valesse no próximo F5, a pessoa promovida continuaria travada na frente de
 * todo mundo sem entender por quê.
 *
 * A ponte existe para os dois módulos não se conhecerem: `http.ts` não importa
 * o servidor de sockets (nem o `io`), e `index.ts` não importa rotas. Quem tem a
 * mesa registra um ouvinte no boot; quem grava o vínculo avisa.
 */

import type { Role } from "@helio/shared";

export interface RoleChange {
  /** Selo da missão onde o papel mudou. */
  code: string;
  /** Nome da **conta**. É o nome que o `Player` carrega (com conta, o nome é o da conta). */
  name: string;
  role: Role;
}

type Listener = (change: RoleChange) => void;

let listener: Listener | null = null;

/** Chamado uma vez, no boot, por quem tem as salas e o `io` na mão. */
export function onRoleChange(fn: Listener): void {
  listener = fn;
}

/** Chamado depois de a gravação dar certo. Sem ouvinte (testes, boot), não faz nada. */
export function roleChanged(change: RoleChange): void {
  listener?.(change);
}
