/**
 * Conexão com o Postgres (ADR #17).
 *
 * Regra que vale a pena repetir: **banco fora não derruba a mesa**. Sem
 * `DATABASE_URL`, ou com o Postgres indisponível, o servidor sobe do mesmo
 * jeito e as salas vivem em memória, como antes. Perder a partida por causa do
 * banco seria pior do que não ter banco.
 *
 * O cliente NUNCA fala com o banco — só o servidor. É essa fronteira que
 * permite trocar esquema sem encostar em `client/` nem em `shared/`.
 */

import { Pool } from "pg";
import type { QueryResultRow } from "pg";

const DATABASE_URL = (process.env.DATABASE_URL ?? "").trim();

/** `false` quando não há banco configurado: tudo degrada para memória. */
export const dbEnabled = DATABASE_URL !== "";

export const pool: Pool | null = dbEnabled
  ? new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
    })
  : null;

/** Erro de conexão não deve ser fatal; só barulhento. */
if (pool) {
  pool.on("error", (err) => {
    console.warn(`[banco] erro na conexão ociosa: ${err.message}`);
  });
}

export async function query<R extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<R[]> {
  if (!pool) throw new Error("banco desligado (DATABASE_URL vazia)");
  const res = await pool.query<R>(text, values as never[]);
  return res.rows;
}

/**
 * Como `query`, mas uma falha vira `null` e um aviso no log — em vez de
 * derrubar quem chamou. É o que a persistência usa: a cena é um bônus, não
 * pode custar a partida.
 */
export async function tryQuery<R extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[],
  label: string,
): Promise<R[] | null> {
  try {
    return await query<R>(text, values);
  } catch (err) {
    console.warn(`[banco] ${label} falhou: ${(err as Error).message}`);
    return null;
  }
}
