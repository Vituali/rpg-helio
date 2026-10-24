/**
 * A API do servidor — contas e missões (docs/DECISOES.md #16, #18 e #19).
 *
 * Tudo vive sob `/api` (o Caddy manda o prefixo inteiro para o app), e as duas
 * famílias são:
 *
 *   /api/auth/*       entrar, sair e "quem sou eu" (ADR #16)
 *   /api/accounts     criar conta (ADR #19)
 *   /api/campaigns    criar, listar e apagar missões (ADR #18)
 *   /api/campaigns/:selo/role   dar/tirar o papel de mestre (ADR #22)
 *
 * O cookie de sessão vai e volta sozinho (mesma origem), e é ele que o Socket.IO
 * lê no handshake — depois do login, o `connect()` não precisa saber de nada
 * disso.
 *
 * A senha NUNCA é guardada aqui: nem em estado, nem em localStorage. Só existe
 * durante a requisição. O que fica no navegador é o cookie `HttpOnly`, que o
 * JavaScript não enxerga de propósito.
 */

import type { Role } from "@helio/shared";
import { useNetStore } from "../state/netStore";

export interface Account {
  id: string;
  name: string;
}

/** Uma missão: o selo é o convite, o nome é o que se lê. */
export interface Campaign {
  code: string;
  name: string;
  createdAt?: string;
  /** O papel desta conta na missão, pelo vínculo (ADR #19). */
  role?: Role;
  /** Só o dono apaga a missão. */
  owner?: boolean;
}

export interface AuthResult {
  ok: boolean;
  account?: Account;
  error?: string;
}

export interface CampaignsResult {
  ok: boolean;
  campaigns?: Campaign[];
  campaign?: Campaign;
  error?: string;
}

/** Quem é este navegador, e o que o servidor deixa fazer sem conta (ADR #19). */
export interface SessionInfo {
  account: Account | null;
  /** Se este servidor aceita cadastro novo. Com `false`, o lobby nem oferece. */
  signup: boolean;
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

/**
 * Quem está logado neste navegador, e se o servidor aceita cadastro novo.
 *
 * As duas respostas vêm de uma rota só (`/api/auth/me`) porque as duas perguntas
 * são feitas no mesmo instante, quando o lobby abre (ADR #19).
 */
export async function loadSession(): Promise<SessionInfo> {
  const body = await request("/api/auth/me");
  if (!body) return { account: null, signup: false };
  const account = body.ok ? ((body.account as Account | undefined) ?? null) : null;
  return { account, signup: body.signup === true };
}

export async function login(name: string, password: string): Promise<AuthResult> {
  const body = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ name, password }),
  });
  if (!body) return { ok: false, error: "Servidor não respondeu." };
  if (!body.ok) {
    return { ok: false, error: String(body.error ?? "Não foi possível entrar.") };
  }
  return { ok: true, account: body.account as Account };
}

/**
 * Cria a conta e já sai logada — o servidor manda o cookie na resposta, igual ao
 * login. A senha não fica em nenhum lugar do cliente.
 */
export async function createAccount(name: string, password: string): Promise<AuthResult> {
  const body = await request("/api/accounts", {
    method: "POST",
    body: JSON.stringify({ name, password }),
  });
  if (!body) return { ok: false, error: "Servidor não respondeu." };
  if (!body.ok) {
    return { ok: false, error: String(body.error ?? "Não foi possível criar a conta.") };
  }
  return { ok: true, account: body.account as Account };
}

export async function logout(): Promise<void> {
  await request("/api/auth/logout", { method: "POST", body: "{}" });
}

/** As missões de quem está logado. Perder o selo não pode ser perder a mesa. */
export async function listCampaigns(): Promise<Campaign[]> {
  const body = await request("/api/campaigns");
  if (!body?.ok) return [];
  return (body.campaigns as Campaign[] | undefined) ?? [];
}

export async function createCampaign(name: string): Promise<CampaignsResult> {
  const body = await request("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (!body) return { ok: false, error: "Servidor não respondeu." };
  if (!body.ok) {
    return { ok: false, error: String(body.error ?? "Não foi possível criar a missão.") };
  }
  return { ok: true, campaign: body.campaign as Campaign };
}

export async function deleteCampaign(code: string): Promise<CampaignsResult> {
  const body = await request(`/api/campaigns/${encodeURIComponent(code)}`, {
    method: "DELETE",
  });
  if (!body) return { ok: false, error: "Servidor não respondeu." };
  if (!body.ok) {
    return { ok: false, error: String(body.error ?? "Não foi possível apagar a missão.") };
  }
  return { ok: true };
}

/**
 * Dá ou tira o papel de mestre de uma conta nesta missão (ADR #22).
 *
 * O alvo é o **nome da conta** — é ele que o painel da mesa mostra e o que o
 * servidor usa para achar o vínculo. Quem pode outorgar é quem já é mestre ali;
 * o servidor confere de novo, e responde 404 para quem não é.
 */
export async function setMemberRole(
  code: string,
  name: string,
  role: Role,
): Promise<CampaignsResult> {
  const body = await request(`/api/campaigns/${encodeURIComponent(code)}/role`, {
    method: "POST",
    body: JSON.stringify({ name, role }),
  });
  if (!body) return { ok: false, error: "Servidor não respondeu." };
  if (!body.ok) {
    return { ok: false, error: String(body.error ?? "Não foi possível mudar o papel.") };
  }
  return { ok: true };
}
