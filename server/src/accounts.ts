/**
 * Contas: leitura e vínculo com campanha (ADR #16 e #17).
 *
 * Tudo aqui degrada para "não existe conta" quando o banco está fora, em vez de
 * lançar: login é um extra, e a mesa tem que abrir de qualquer jeito.
 */

import { dbEnabled, tryQuery } from "./db.js";
import type { Role } from "@helio/shared";

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
 * Registra que esta conta jogou nesta campanha.
 *
 * `do nothing` no conflito, de propósito: o papel que vale é o que está em
 * `campaign.gm_account_id` e no que o servidor decidiu agora. Um jogador que
 * entra depois não pode rebaixar (nem promover) o vinculo de ninguém.
 */
export async function touchMembership(
  accountId: string,
  campaignId: string | null,
  role: Role,
): Promise<void> {
  if (!dbEnabled || !campaignId) return;
  await tryQuery(
    `insert into membership (account_id, campaign_id, role)
     values ($1, $2, $3)
     on conflict (account_id, campaign_id) do nothing`,
    [accountId, campaignId, role],
    "registrar vinculo",
  );
}
