/**
 * Persistência da cena (ADR #17).
 *
 * A cena viva continua em memória — rápida, como sempre foi. O banco é a cópia
 * durável, e é escrito **com debounce**: gravar a cada evento seria
 * amplificação de escrita por nada, porque cada mudança já transmite a cena
 * inteira para todos os jogadores.
 *
 * Portanto: o banco pode estar fora, devagar ou ausente. Nenhum caminho aqui
 * derruba a mesa — no pior caso, a partida não sobrevive a um restart.
 */

import { FOG_NONE, clamp, resizeGrid, uid } from "@helio/shared";
import type { Actor, Facing, FogMode, FogValue, Sector } from "@helio/shared";
import { hashPassword } from "./auth.js";
import { dbEnabled, tryQuery } from "./db.js";
import { createScene, type Room, type ServerScene } from "./room.js";

/** Versão do formato guardado em `scene.data`. */
export const SCENE_SCHEMA = 1;

/** Espera depois da última mudança antes de gravar. */
const SAVE_DEBOUNCE_MS = Number(process.env.SCENE_SAVE_MS ?? 3000);

/**
 * Conta do mestre-semente, usada como dona das campanhas criadas
 * automaticamente. Resolvida no boot (ver `seedMaster` em index.ts).
 */
let defaultGmAccountId: string | null = null;
export function setDefaultGmAccount(id: string | null): void {
  defaultGmAccountId = id;
}

// ── Campanha ─────────────────────────────────────────────────────────────────

export interface CampaignRef {
  id: string;
  /**
   * Conta dona da campanha. É o que dá o papel de mestre **sem senha**: quem é
   * dono não precisa saber segredo nenhum (ADR #16).
   */
  gmAccountId: string | null;
}

/**
 * Garante que existe uma campanha para este código e devolve a referência dela.
 *
 * Enquanto não existe tela de criar campanha (entrega 3), entrar com um selo
 * novo cria a campanha na hora. É o caminho que mantém o comportamento atual —
 * e é o furo anotado no KANBAN: sem limite, qualquer código novo cria uma linha.
 */
export async function ensureCampaign(code: string): Promise<CampaignRef | null> {
  if (!dbEnabled) return null;
  const rows = await tryQuery<{ id: string; gm_account_id: string | null }>(
    `with ins as (
       insert into campaign (id, code, name, gm_account_id)
       values ($1, $2, $3, $4)
       on conflict (code) do nothing
       returning id, gm_account_id
     )
     select id, gm_account_id from ins
     union all
     select id, gm_account_id from campaign where code = $2
     limit 1`,
    [uid("camp"), code, code, defaultGmAccountId],
    `criar campanha ${code}`,
  );
  const row = rows?.[0];
  return row ? { id: row.id, gmAccountId: row.gm_account_id } : null;
}

// ── Serialização ─────────────────────────────────────────────────────────────

/**
 * O que vai para o banco. Não é o `ServerScene` inteiro:
 *  - `version` é contador de sessão, não faz sentido persistido;
 *  - `ownerId` é um socket (não sobrevive ao restart);
 *  - `path` é predição do cliente e no servidor está sempre vazio;
 *  - token de jogador sai fora (ver `pcActors` em room.ts).
 */
interface PersistedActor extends Omit<Actor, "ownerId" | "path"> {}

interface PersistedScene {
  schemaVersion: number;
  cols: number;
  rows: number;
  cell: number;
  bgImage: string | null;
  fogMode: FogMode;
  walls: boolean[][];
  fogExplored: number[][];
  actors: PersistedActor[];
  sectors: Sector[];
}

export function persistableScene(room: Room): PersistedScene {
  const s = room.scene;
  return {
    schemaVersion: SCENE_SCHEMA,
    cols: s.cols,
    rows: s.rows,
    cell: s.cell,
    bgImage: s.bgImage,
    fogMode: s.fogMode,
    walls: s.walls,
    fogExplored: s.fogExplored,
    actors: s.actors
      .filter((a) => a.ownerId === null && !room.pcActors.has(a.id))
      .map(({ ownerId: _o, path: _p, ...rest }) => rest),
    sectors: s.sectors,
  };
}

/** Garante "array de arrays" antes de mexer — o `data` pode ter vindo torto. */
function asGrid(value: unknown): unknown[][] {
  return Array.isArray(value) ? value.map((row) => (Array.isArray(row) ? row : [])) : [];
}

const FACINGS: Facing[] = ["n", "s", "e", "w"];

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

/**
 * Reconstrói a cena a partir do que estava no banco.
 *
 * Aqui não se confia em nada: o `data` é o único lugar do servidor onde entra
 * dado que não passou por validação de mensagem — pode ser uma linha antiga, de
 * outro formato, ou editada à mão. Tudo é coagido, cortado e limitado. Devolve
 * `null` quando não dá para aproveitar nada.
 */
export function sceneFromPersisted(raw: unknown): ServerScene | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Partial<PersistedScene>;
  if (numberOr(d.schemaVersion, 0) !== SCENE_SCHEMA) return null;

  const rows = clamp(numberOr(d.rows, 22), 5, 60);
  const cols = clamp(numberOr(d.cols, 30), 5, 80);
  const scene = createScene();

  scene.rows = rows;
  scene.cols = cols;
  scene.cell = clamp(numberOr(d.cell, 48), 16, 96);
  scene.bgImage = typeof d.bgImage === "string" ? d.bgImage : null;
  scene.fogMode = d.fogMode === "hard" ? "hard" : "soft";

  const walls = asGrid(d.walls).map((row) => row.map((v) => v === true));
  scene.walls = resizeGrid(walls, rows, cols, false);

  const fog = asGrid(d.fogExplored).map((row) =>
    row.map<FogValue>((v) => (v === 1 || v === 2 || v === 3 ? v : FOG_NONE)),
  );
  scene.fogExplored = resizeGrid(fog, rows, cols, FOG_NONE);

  const actors = Array.isArray(d.actors) ? d.actors : [];
  scene.actors = actors.map((a, i): Actor => {
    const p = (a ?? {}) as Partial<PersistedActor>;
    return {
      id: stringOr(p.id, `tok_restaurado_${i}`),
      name: stringOr(p.name, `NPC ${i + 1}`).slice(0, 40),
      // Sem dono de propósito: quem controla é o mestre até alguém assumir.
      ownerId: null,
      row: clamp(numberOr(p.row, 0), 0, rows - 1),
      col: clamp(numberOr(p.col, 0), 0, cols - 1),
      facing: FACINGS.includes(p.facing as Facing) ? (p.facing as Facing) : "s",
      vision: clamp(numberOr(p.vision, 4), 0, 20),
      sprite: stringOr(p.sprite, "hero").slice(0, 60),
      portrait: typeof p.portrait === "string" ? p.portrait : null,
      color: stringOr(p.color, "#7c3aed").slice(0, 32),
      canMove: p.canMove === true,
      path: [],
    };
  });

  const sectors = Array.isArray(d.sectors) ? d.sectors : [];
  scene.sectors = sectors.map((s, i): Sector => {
    const p = (s ?? {}) as Partial<Sector>;
    return {
      id: stringOr(p.id, `sec_restaurado_${i}`),
      name: stringOr(p.name, "Setor").slice(0, 40),
      r1: clamp(numberOr(p.r1, 0), 0, rows - 1),
      c1: clamp(numberOr(p.c1, 0), 0, cols - 1),
      r2: clamp(numberOr(p.r2, 0), 0, rows - 1),
      c2: clamp(numberOr(p.c2, 0), 0, cols - 1),
      color: stringOr(p.color, "#d4a017").slice(0, 32),
    };
  });

  return scene;
}

// ── Leitura e escrita ────────────────────────────────────────────────────────

export async function loadScene(campaignId: string | null): Promise<ServerScene | null> {
  if (!dbEnabled || !campaignId) return null;
  const rows = await tryQuery<{ data: unknown }>(
    "select data from scene where campaign_id = $1",
    [campaignId],
    `carregar cena ${campaignId}`,
  );
  const scene = sceneFromPersisted(rows?.[0]?.data);
  if (scene) console.log(`[banco] cena carregada (${campaignId})`);
  return scene;
}

const timers = new Map<string, NodeJS.Timeout>();

/** Marca que a cena mudou. A gravação acontece depois da última mudança. */
export function scheduleSave(room: Room): void {
  const campaignId = room.campaignId;
  if (!dbEnabled || !campaignId) return;

  const running = timers.get(campaignId);
  if (running) clearTimeout(running);
  timers.set(
    campaignId,
    setTimeout(() => {
      void saveRoom(room);
    }, SAVE_DEBOUNCE_MS),
  );
}

/** Grava agora, sem esperar. Usado quando a sala fica vazia. */
export async function flushRoom(room: Room): Promise<void> {
  await saveRoom(room);
}

async function saveRoom(room: Room): Promise<void> {
  const campaignId = room.campaignId;
  if (!dbEnabled || !campaignId) return;

  const running = timers.get(campaignId);
  if (running) {
    clearTimeout(running);
    timers.delete(campaignId);
  }

  const payload = JSON.stringify(persistableScene(room));
  await tryQuery(
    `insert into scene (campaign_id, data, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (campaign_id)
     do update set data = excluded.data, updated_at = now()`,
    [campaignId, payload],
    `salvar cena ${campaignId}`,
  );
}

// ── Conta-semente (passo 1: só para a campanha ter um dono) ──────────────────

/**
 * Cria a conta do mestre se ela ainda não existir.
 *
 * Nunca sobrescreve uma senha existente: rodar o servidor de novo não pode
 * resetar a senha de ninguém. Sem `SEED_MASTER_*` configurado, não faz nada.
 */
export async function seedMaster(): Promise<string | null> {
  const user = (process.env.SEED_MASTER_USER ?? "").trim();
  const pass = process.env.SEED_MASTER_PASS ?? "";
  if (!dbEnabled || user === "" || pass === "") return null;

  const existing = await tryQuery<{ id: string }>(
    "select id from account where lower(name) = lower($1)",
    [user],
    "procurar conta-semente",
  );
  if (existing?.[0]) return existing[0].id;
  if (existing === null) return null; // banco fora agora; tenta no próximo boot

  const id = uid("acc");
  const created = await tryQuery(
    "insert into account (id, name, password_hash) values ($1, $2, $3) on conflict do nothing",
    [id, user, await hashPassword(pass)],
    "semear conta do mestre",
  );
  if (created === null) return null;
  console.log(`[conta] mestre semeado: ${user}`);
  return id;
}
