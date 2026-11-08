/**
 * A API do servidor — contas e missões (docs/DECISOES.md #16, #18 e #19).
 *
 * Tudo vive sob `/api` (o Caddy manda o prefixo inteiro para o app), e as duas
 * famílias são:
 *
 *   /api/auth/*       entrar, sair e "quem sou eu" (ADR #16)
 *   /api/accounts     criar conta (ADR #19)
 *   /api/settings     o que o servidor oferece hoje (ADR #25)
 *   /api/campaigns    criar, listar e apagar missões (ADR #18)
 *   /api/campaigns/:selo/role   dar/tirar o papel de mestre (ADR #22)
 *   /api/admin/*      contas, senha, administração e configuração (ADRs #23–#25)
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
  /** Esta conta pode abrir o painel do administrador (ADR #23)? */
  admin?: boolean;
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

/** O que o servidor oferece agora — sem sessão (ADR #25). */
export interface ServerSettings {
  /** Aceita conta nova neste instante? */
  signup: boolean;
  /** Selo da "sala da casa"; vazio = nenhuma. */
  defaultRoom: string;
}

/**
 * Configuração pública do servidor (ADR #25).
 *
 * Separada do `/auth/me` porque o lobby pergunta antes (e independente) de haver
 * login. `defaultRoom` é o selo que o painel marcou como a mesa do grupo; quem
 * ainda não é membro vê um atalho para ele.
 */
export async function getSettings(): Promise<ServerSettings> {
  const body = await request("/api/settings");
  if (!body) return { signup: false, defaultRoom: "" };
  return {
    signup: body.signup === true,
    defaultRoom: typeof body.defaultRoom === "string" ? body.defaultRoom : "",
  };
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

export async function renameCampaign(code: string, name: string): Promise<CampaignsResult> {
  const body = await request(
    `/api/campaigns/${encodeURIComponent(code)}/name`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
  if (!body) return { ok: false, error: "Servidor não respondeu." };
  if (!body.ok) {
    return { ok: false, error: String(body.error ?? "Não foi possível renomear a missão.") };
  }
  return { ok: true, campaign: body.campaign as Campaign };
}

export async function deleteAccount(name: string): Promise<{ ok: boolean; error?: string }> {
  const body = await request(`/admin/accounts/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!body) return { ok: false, error: "Servidor não respondeu." };
  if (!body.ok) {
    return { ok: false, error: String(body.error ?? "Não foi possível excluir a conta.") };
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

// ── Painel do administrador (ADR #23) ────────────────────────────────────────
//
// Duas chamadas, e só. O servidor confere se a sessão é da conta de
// administração em cada uma: o link escondido na tela é conveniência, não
// permissão.

/** Uma conta como o painel enxerga: nome, desde quando e o quanto já jogou. */
export interface AdminAccount {
  id: string;
  name: string;
  createdAt: string;
  /** Último login, ou `null` para quem nunca entrou. */
  lastLoginAt: string | null;
  /** Administrador delegado. A raiz é reconhecida pelo nome, não por este campo. */
  isAdmin: boolean;
  owned: number;
  joined: number;
}

export interface AdminListResult {
  ok: boolean;
  /** O nome da conta de administração neste servidor (`ADMIN_ACCOUNT`). */
  admin?: string;
  accounts?: AdminAccount[];
  error?: string;
}

export async function listAllAccounts(): Promise<AdminListResult> {
  const body = await request("/api/admin/accounts");
  if (!body) return { ok: false, error: "Servidor não respondeu." };
  if (!body.ok) {
    return { ok: false, error: String(body.error ?? "Não deu para listar as contas.") };
  }
  return {
    ok: true,
    admin: typeof body.admin === "string" ? body.admin : undefined,
    accounts: (body.accounts as AdminAccount[] | undefined) ?? [],
  };
}

/**
 * Define a senha de uma conta (não pede a antiga: é o administrador).
 *
 * Isto **não** derruba sessões abertas — o cookie é assinado e não consulta o
 * banco (ADR #16). Quem já estava logado continua; para derrubar todos, troque
 * `SESSION_SECRET`.
 */
export async function resetPassword(
  name: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const body = await request(`/api/admin/accounts/${encodeURIComponent(name)}/password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  if (!body) return { ok: false, error: "Servidor não respondeu." };
  if (!body.ok) {
    return { ok: false, error: String(body.error ?? "Não deu para trocar a senha.") };
  }
  return { ok: true };
}

/**
 * Dá ou tira a administração de uma conta (ADR #24).
 *
 * Vale na hora no servidor; no navegador da outra pessoa, só na próxima carga da
 * página — é o `/api/auth/me` que conta ao cliente que ele é admin.
 */
export async function setAccountAdmin(
  name: string,
  admin: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const body = await request(`/api/admin/accounts/${encodeURIComponent(name)}/admin`, {
    method: "POST",
    body: JSON.stringify({ admin }),
  });
  if (!body) return { ok: false, error: "Servidor não respondeu." };
  if (!body.ok) {
    return { ok: false, error: String(body.error ?? "Não deu para mudar a administração.") };
  }
  return { ok: true };
}

/** A configuração do servidor como o painel a vê (ADR #25). */
export interface AdminSettings {
  registration: "open" | "closed";
  /** Selo da sala da casa; vazio = nenhuma. */
  defaultRoom: string;
}

export interface AdminSettingsResult {
  ok: boolean;
  settings?: AdminSettings;
  error?: string;
}

function readSettings(body: Record<string, unknown> | null): AdminSettingsResult {
  if (!body) return { ok: false, error: "Servidor não respondeu." };
  if (!body.ok) {
    return { ok: false, error: String(body.error ?? "Não deu para falar da configuração.") };
  }
  const raw = (body.settings ?? {}) as Partial<AdminSettings>;
  return {
    ok: true,
    settings: {
      registration: raw.registration === "closed" ? "closed" : "open",
      defaultRoom: typeof raw.defaultRoom === "string" ? raw.defaultRoom : "",
    },
  };
}

export async function getAdminSettings(): Promise<AdminSettingsResult> {
  return readSettings(await request("/api/admin/settings"));
}

/**
 * Muda cadastro e/ou sala da casa (ADR #25). Vale na hora, sem restart.
 *
 * A sala da casa é validada no servidor: selo inexistente dá 404 em vez de virar
 * um atalho que não abre.
 */
export async function saveAdminSettings(patch: {
  registration?: boolean;
  defaultRoom?: string;
}): Promise<AdminSettingsResult> {
  return readSettings(
    await request("/api/admin/settings", {
      method: "POST",
      body: JSON.stringify(patch),
    }),
  );
}
