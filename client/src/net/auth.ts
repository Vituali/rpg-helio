/**
 * Contas — as rotas HTTP de autenticação (docs/DECISOES.md #16).
 *
 * Três chamadas só: entrar, sair e "quem sou eu". O cookie de sessão vai e volta
 * sozinho (mesma origem), e é ele que o Socket.IO lê no handshake — depois do
 * login, o `connect()` não precisa saber de nada disso.
 *
 * A senha NUNCA é guardada aqui: nem em estado, nem em localStorage. Só existe
 * durante a requisição. O que fica no navegador é o cookie `HttpOnly`, que o
 * JavaScript não enxerga de propósito.
 */

import { useNetStore } from "../state/netStore";

export interface Account {
  id: string;
  name: string;
}

export interface AuthResult {
  ok: boolean;
  account?: Account;
  error?: string;
}

/**
 * Onde ficam as rotas de auth.
 *
 * Mesma base do Socket.IO, pelo mesmo motivo: quem aponta o cliente para outro
 * servidor espera que TUDO vá para lá. Vazio significa "esta origem".
 */
function base(): string {
  const url = useNetStore.getState().serverUrl ?? "";
  return url.trim().replace(/\/+$/, "");
}

async function request(
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${base()}${path}`, {
      // Mesma origem manda o cookie; origem diferente não mandaria de qualquer
      // forma, e aí a sessão simplesmente não existe.
      credentials: "same-origin",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      ...init,
    });
    return (await res.json()) as Record<string, unknown>;
  } catch {
    // Rede fora, servidor desligado: para quem chamou, é o mesmo que "não sei
    // quem você é". Nada aqui pode impedir a mesa de abrir.
    return null;
  }
}

/** Quem está logado neste navegador, se alguém estiver. */
export async function refreshAccount(): Promise<Account | null> {
  const body = await request("/auth/me");
  if (!body?.ok) return null;
  const account = body.account as Account | undefined;
  return account ?? null;
}

export async function login(name: string, password: string): Promise<AuthResult> {
  const body = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ name, password }),
  });
  if (!body) return { ok: false, error: "Servidor não respondeu." };
  if (!body.ok) {
    return { ok: false, error: String(body.error ?? "Não foi possível entrar.") };
  }
  return { ok: true, account: body.account as Account };
}

export async function logout(): Promise<void> {
  await request("/auth/logout", { method: "POST", body: "{}" });
}
