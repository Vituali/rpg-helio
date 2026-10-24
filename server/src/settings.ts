/**
 * Configuração viva do servidor (ADR #25).
 *
 * Cadastro aberto e sala da casa nasceram como variáveis de ambiente: mudar
 * exigia editar o `deploy/.env` e reiniciar o `app`. São decisões de operação —
 * "fecha o cadastro agora", "a mesa do grupo virou outra" —, e reiniciar por
 * isso é caro demais quando já existe um painel.
 *
 * O banco guarda o que o painel mudou (`app_setting`); o ambiente é o **padrão
 * de fábrica**: vale num banco novo e quando o banco está fora. A partir do
 * primeiro clique no painel, o banco manda — se o `.env` discordar, o painel
 * ganha. O boot diz o que está valendo, para não haver dúvida.
 *
 * Sem banco não há como gravar: a rota do painel responde 503 e **nada muda na
 * memória**. Dizer "troquei" e voltar no próximo boot seria pior do que recusar.
 */

import { dbEnabled, tryQuery } from "./db.js";
import { normalizeCode } from "./selo.js";

export interface Settings {
  /** O servidor aceita conta nova agora? (ADR #19) */
  registrationOpen: boolean;
  /**
   * Selo da "sala da casa" — a que o lobby oferece a quem ainda não é membro.
   * Vazio = nenhuma; e aí o lobby só mostra as missões da pessoa (ADR #25).
   */
  defaultRoom: string;
}

/** Padrão de fábrica. `REGISTRATION=closed` fecha; `ROOM_CODE` sugere a sala. */
const envRegistration =
  (process.env.REGISTRATION ?? "open").trim().toLowerCase() !== "closed";
const envRoom = normalizeCode(process.env.ROOM_CODE ?? "");

let current: Settings = {
  registrationOpen: envRegistration,
  defaultRoom: envRoom,
};

/** O que o servidor está usando agora. */
export function settings(): Settings {
  return current;
}

/**
 * O cadastro está aberto? É função, não constante: o `/auth/me` e a criação de
 * conta consultam a cada requisição, e o painel pode fechar a porta no meio da
 * sessão sem restart (ADR #25).
 */
export function registrationOpen(): boolean {
  return current.registrationOpen;
}

/**
 * Aplica o que o painel já tinha salvo. Roda no boot, depois das migrations.
 *
 * Falha de banco não derruba nada: fica o padrão do ambiente, que é o mesmo que
 * um servidor recém-instalado teria. Se o banco voltar depois, a configuração
 * salva entra no próximo start.
 */
export async function loadSettings(): Promise<void> {
  if (!dbEnabled) return;
  const rows = await tryQuery<{ key: string; value: string }>(
    "select key, value from app_setting",
    [],
    "ler configuracao",
  );
  if (rows === null) return;
  for (const row of rows) {
    if (row.key === "registration") current.registrationOpen = row.value !== "closed";
    if (row.key === "default_room") current.defaultRoom = normalizeCode(row.value);
  }
}

export interface SettingsPatch {
  registration?: boolean;
  defaultRoom?: string;
}

/**
 * Grava e aplica na hora, numa instrução só.
 *
 * Um `insert ... on conflict` com as linhas que mudaram: ou tudo entra, ou nada
 * entra. `false` = banco não respondeu, e a memória ficou como estava.
 */
export async function saveSettings(patch: SettingsPatch): Promise<boolean> {
  if (!dbEnabled) return false;

  const entries: [string, string][] = [];
  if (patch.registration !== undefined) {
    entries.push(["registration", patch.registration ? "open" : "closed"]);
  }
  if (patch.defaultRoom !== undefined) {
    entries.push(["default_room", normalizeCode(patch.defaultRoom)]);
  }
  if (entries.length === 0) return true;

  const values: string[] = [];
  const tuples = entries.map(([key, value], i) => {
    values.push(key, value);
    return `($${i * 2 + 1}, $${i * 2 + 2})`;
  });

  const rows = await tryQuery<{ key: string }>(
    `insert into app_setting (key, value)
     values ${tuples.join(", ")}
     on conflict (key) do update set value = excluded.value, updated_at = now()
     returning key`,
    values,
    "gravar configuracao",
  );
  if (rows === null) return false;

  if (patch.registration !== undefined) current.registrationOpen = patch.registration;
  if (patch.defaultRoom !== undefined) current.defaultRoom = normalizeCode(patch.defaultRoom);
  return true;
}
