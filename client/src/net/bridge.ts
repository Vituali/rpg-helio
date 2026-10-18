/**
 * Ponte entre o store do jogo e a rede.
 *
 * Existe para evitar dependência circular: o store importa daqui (só estas
 * funções), e `net/socket.ts` é quem instala o transmissor de verdade quando
 * conecta. Sem conexão, `isOnline()` é falso e o store funciona sozinho
 * (modo local, como nas Fases 0/1).
 */

export type Sender = (event: string, payload: unknown) => void;

let sender: Sender | null = null;

/** Instalado por `net/socket.ts` ao conectar; `null` derruba para modo local. */
export function setSender(fn: Sender | null): void {
  sender = fn;
}

export function isOnline(): boolean {
  return sender !== null;
}

export function send(event: string, payload: unknown): void {
  sender?.(event, payload);
}
