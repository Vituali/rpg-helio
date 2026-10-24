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
}

/** Busca por nome, sem diferenciar maiúscula de minúscula (índice em `lower(name)`). */
export async function findAccountByName(name: string): Promise<AccountRow | null> {
  if (!dbEnabled) return null;
  const rows = await tryQuery<AccountRow>(
    "select id, name, password_hash from account where lower(name) = lower($1)",
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

// ── Administração (ADR #23) ──────────────────────────────────────────────────
//
// O painel existe para uma coisa que hoje não tem outro caminho: **trocar a
// senha de alguém**. Não há recuperação de senha, e sem isto a única saída seria
// mexer no banco na mão. É deliberadamente pequeno: listar contas e definir
// senha. Nada de apagar conta (deixaria missão órfã) nem de mudar papel (isso é
// do vínculo, na mesa).

/** Uma conta vista pelo administrador: quem é, desde quando e o quanto já jogou. */
export interface AdminAccountRow {
  id: string;
  name: string;
  createdAt: string;
  /** Missões das quais é dona. */
  owned: number;
  /** Missões em que tem vínculo (como mestre ou agente). */
  joined: number;
}

/**
 * Todas as contas, em ordem de criação.
 *
 * A data vai como ISO para o cliente formatar: o servidor não sabe o fuso de
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
    owned: string;
    joined: string;
  }>(
    `select a.id, a.name, a.created_at,
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
