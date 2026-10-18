/**
 * Migrations em SQL numerado (ADR #17).
 *
 * Sem framework: lê `server/migrations/*.sql` em ordem, aplica o que ainda não
 * rodou e registra em `schema_migrations`. Cada arquivo roda numa transação —
 * ou aplica inteiro, ou não aplica nada. Um advisory lock evita que dois
 * processos apliquem a mesma migration ao mesmo tempo.
 *
 * Arquivo aplicado não se edita. Uma correção é sempre um arquivo novo.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query } from "./db.js";

/** `server/migrations`, ao lado de `src/`. */
const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

/** Número arbitrário, só precisa ser o mesmo em todo processo que migra. */
const LOCK_KEY = 918_273_645;

export async function migrate(): Promise<void> {
  if (!pool) return;

  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`
      create table if not exists schema_migrations (
        version    text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const applied = new Set(
      (await query<{ version: string }>("select version from schema_migrations")).map(
        (r) => r.version,
      ),
    );

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (version) values ($1)", [file]);
        await client.query("commit");
        console.log(`[banco] migration aplicada: ${file}`);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`migration ${file} falhou: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    client.release();
  }
}
