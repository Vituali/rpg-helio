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
