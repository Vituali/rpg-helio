/**
 * Contas: criar, ler e vincular a campanha (ADR #16, #17 e #19).
 *
 * Tudo aqui degrada para "não existe conta" quando o banco está fora, em vez de
 * lançar: conta é um extra, e a mesa tem que abrir de qualquer jeito.
 */

import { uid } from "@helio/shared";
import { hashPassword } from "./auth.js";
import { dbEnabled, tryQuery } from "./db.js";

export interface AccountRow {
  id: string;
  name: string;
  password_hash: string;
  /** Administrador delegado (ADR #24). A raiz é decidida pelo nome, não aqui. */
  is_admin: boolean;
}

/** Busca por nome, sem diferenciar maiúscula de minúscula (índice em `lower(name)`). */
export async function findAccountByName(name: string): Promise<AccountRow | null> {
  if (!dbEnabled) return null;
  const rows = await tryQuery<AccountRow>(
    "select id, name, password_hash, is_admin from account where lower(name) = lower($1)",
    [name],
    "buscar conta",
  );
  return rows?.[0] ?? null;
}

export interface AccountPublic {
  id: string;
  name: string;
}

export async function findAccountById(id: string): Promise<AccountPublic | null> {
  if (!dbEnabled) return null;
  const rows = await tryQuery<AccountPublic>(
    "select id, name from account where id = $1",
    [id],
    "buscar conta por id",
  );
  return rows?.[0] ?? null;
}

/**
 * A conta é administradora delegada? (ADR #24)
 *
 * `null` não é "não" — é **não sei**: o banco está fora. Quem chama decide o que
 * fazer com a dúvida; a rota do painel é conservadora e trata como "não".
 *
 * Isto é uma leitura por requisição de painel, e é de propósito: conceder ou
 * tirar admin precisa valer **na hora**, e o cookie é assinado (não dá para
 * mudar o que ele afirma sem reemitir). A raiz não depende desta consulta.
 */
export async function accountIsAdmin(id: string): Promise<boolean | null> {
  if (!dbEnabled) return null;
  const rows = await tryQuery<{ is_admin: boolean }>(
    "select is_admin from account where id = $1",
    [id],
    "buscar admin da conta",
  );
  if (rows === null) return null;
  return rows[0]?.is_admin === true;
}

/** Marca o acesso agora — o painel mostra "visto por último" (ADR #24). */
export async function touchLogin(id: string): Promise<void> {
  if (!dbEnabled) return;
  await tryQuery("update account set last_login_at = now() where id = $1", [id], "marcar acesso");
}

/**
 * Cria a conta — o cadastro do lobby (ADR #19).
 *
 * O `on conflict do nothing` sem alvo cobre o `unique` de `lower(name)`, que é o
 * que impede duas pessoas de terem o mesmo nome. Não dá para distinguir os dois
 * casos olhando o erro com este helper, então a ausência de linha **é** o
 * veredito: `[]` = nome tomado, `"taken"` aqui. `null` é outra coisa — é o banco
 * fora, e aí o lobby precisa dizer "não deu", não "nome tomado".
 */
export async function createAccount(
  name: string,
  password: string,
): Promise<AccountPublic | "taken" | null> {
  if (!dbEnabled) return null;
  const rows = await tryQuery<AccountPublic>(
    `insert into account (id, name, password_hash)
     values ($1, $2, $3)
     on conflict do nothing
     returning id, name`,
    [uid("acc"), name, await hashPassword(password)],
    `criar conta ${name}`,
  );
  if (rows === null) return null;
  return rows[0] ?? "taken";
}

/**
 * Registra que esta conta passou por esta missão (ADR #19).
 *
 * O papel gravado é sempre `player`, e isso é a regra, não um esquecimento:
 * **estar na mesa é ser agente dela; ser mestre é outorga explícita** (hoje, só
 * criar a missão). Sem isto, entrar com a `GM_KEY` — uma senha compartilhada —
 * promoveria a pessoa para sempre, em silêncio.
 *
 * `do nothing` no conflito: quem já está no quadro não é rebaixado por entrar
 * como jogador. Um mestre pode querer jogar como agente numa sessão.
 */
export async function touchMembership(
  accountId: string,
  campaignId: string | null,
): Promise<void> {
  if (!dbEnabled || !campaignId) return;
  await tryQuery(
    `insert into membership (account_id, campaign_id, role)
     values ($1, $2, 'player')
     on conflict (account_id, campaign_id) do nothing`,
    [accountId, campaignId],
    "registrar vinculo",
  );
}

// ── Administração (ADRs #23 e #24) ───────────────────────────────────────────
//
// O painel existe para uma coisa que hoje não tem outro caminho: **trocar a
// senha de alguém** — e, desde o ADR #24, **delegar a administração**. Não há
// recuperação de senha, e sem isto a única saída seria mexer no banco na mão.
// Continua pequeno de propósito: nada de apagar conta (deixaria missão órfã) nem
// de mudar papel (isso é do vínculo, na mesa).

/** Uma conta vista pelo administrador: quem é, desde quando e o quanto já jogou. */
export interface AdminAccountRow {
  id: string;
  name: string;
  createdAt: string;
  /** Último login, ou `null` para quem nunca entrou depois do ADR #24. */
  lastLoginAt: string | null;
  /** Administrador delegado. A raiz aparece com este campo `false` e é o nome. */
  isAdmin: boolean;
  /** Missões das quais é dona. */
  owned: number;
  /** Missões em que tem vínculo (como mestre ou agente). */
  joined: number;
}

/**
 * Todas as contas, em ordem de criação.
 *
 * As datas vão como ISO para o cliente formatar: o servidor não sabe o fuso de
 * quem está olhando. `count(*)` no Postgres volta como string (é `bigint`), e
 * por isso o `Number()` — sem ele, o JSON sairia com `"2"` onde o painel espera
 * um número.
 */
export async function listAccounts(): Promise<AdminAccountRow[] | null> {
  if (!dbEnabled) return null;
  const rows = await tryQuery<{
    id: string;
    name: string;
    created_at: Date;
    last_login_at: Date | null;
    is_admin: boolean;
    owned: string;
    joined: string;
  }>(
    `select a.id, a.name, a.created_at, a.last_login_at, a.is_admin,
            (select count(*) from campaign c where c.gm_account_id = a.id) as owned,
            (select count(*) from membership m where m.account_id = a.id) as joined
       from account a
      order by a.created_at asc, lower(a.name) asc`,
    [],
    "listar contas",
  );
  if (rows === null) return null;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at.toISOString(),
    lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null,
    isAdmin: r.is_admin === true,
    owned: Number(r.owned),
    joined: Number(r.joined),
  }));
}

export type PasswordResult = "ok" | "notfound" | "error";

/**
 * Define a senha de uma conta pelo nome (ADR #23).
 *
 * Sobrescreve, não "recupera": a senha antiga não é guardada em lugar nenhum que
 * dê para ler. O hash novo é gerado com os mesmos parâmetros do cadastro, e a
 * sessão de quem já estava logado **continua valendo** — o cookie é assinado e
 * não consulta o banco (ADR #16). Para derrubar todo mundo, troque
 * `SESSION_SECRET`; isso está dito no painel e no DEPLOY.
 */
export async function setAccountPassword(
  name: string,
  password: string,
): Promise<PasswordResult> {
  if (!dbEnabled) return "error";
  const rows = await tryQuery<{ name: string }>(
    `update account set password_hash = $2
      where lower(name) = lower($1)
      returning name`,
    [name, await hashPassword(password)],
    `trocar senha de ${name}`,
  );
  if (rows === null) return "error";
  return rows[0] ? "ok" : "notfound";
}

/**
 * Dá ou tira o papel de administrador de uma conta (ADR #24).
 *
 * A raiz não passa por aqui: quem tem o nome do `ADMIN_ACCOUNT` é administrador
 * pelo nome, e a rota recusa rebaixá-la antes de chegar neste `update`. O efeito
 * é imediato porque a checagem do painel lê esta coluna a cada requisição — não
 * há cookie para reemitir nem sessão para recriar.
 */
export async function setAccountAdmin(
  name: string,
  admin: boolean,
): Promise<PasswordResult> {
  if (!dbEnabled) return "error";
  const rows = await tryQuery<{ name: string }>(
    `update account set is_admin = $2
      where lower(name) = lower($1)
      returning name`,
    [name, admin],
    `${admin ? "dar" : "tirar"} admin de ${name}`,
  );
  if (rows === null) return "error";
  return rows[0] ? "ok" : "notfound";
}

/** Exclui uma conta. Não apaga a conta raiz de administração. */
export async function deleteAccount(name: string): Promise<"ok" | "notfound" | "error"> {
  if (!dbEnabled) return "error";
  const rows = await tryQuery<{ name: string }>(
    `delete from account where lower(name) = lower($1) returning name`,
    [name],
    `apagar conta ${name}`,
  );
  if (rows === null) return "error";
  return rows[0] ? "ok" : "notfound";
}
