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
import type { Actor, Facing, FogMode, FogValue, Role, Sector } from "@helio/shared";
import { hashPassword } from "./auth.js";
import { dbEnabled, tryQuery } from "./db.js";
import { createScene, type Room, type ServerScene } from "./room.js";
import { newSelo } from "./selo.js";

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
  /** Nome humano da missão. O selo é o convite; isto é o que se lê. */
  name: string;
  /**
   * O papel de quem está entrando, pelo **vínculo** com esta missão (ADR #19).
   * `null` = esta conta nunca entrou nesta mesa (e o banco pode estar fora).
   *
   * O papel deixou de ser "é a conta dona da campanha": o dono é o
   * administrador (criar, apagar), e mestre é uma linha em `membership`.
   */
  memberRole: Role | null;
}

/**
 * O veredito sobre um selo (ADR #18).
 *
 * A distinção entre "não existe" e "não deu para saber" é o que impede o banco
 * de derrubar a mesa: sem banco não há como confirmar campanha nenhuma, e
 * recusar todo mundo transformaria "banco caiu" em "mesa não abre".
 */
export interface CampaignLookup {
  /** A campanha, quando o selo existe. */
  campaign: CampaignRef | null;
  /** `false` = o banco não respondeu, então não existe veredito. */
  checked: boolean;
}

/**
 * Procura a campanha pelo Selo, junto com o papel de quem está entrando.
 * **Não cria nada**: selo desconhecido é selo errado, e quem recusa é
 * `room:join` (ADR #18).
 *
 * O papel vem na mesma consulta de propósito: são a mesma pergunta ("esta
 * pessoa pode entrar aqui, e como?"), e duas idas ao banco abririam uma janela
 * em que a missão existe mas o vínculo ainda não chegou.
 */
export async function findCampaign(
  code: string,
  accountId: string,
): Promise<CampaignLookup> {
  if (!dbEnabled) return { campaign: null, checked: false };
  const rows = await tryQuery<{ id: string; name: string; member_role: Role | null }>(
    `select c.id, c.name, m.role as member_role
       from campaign c
       left join membership m
         on m.campaign_id = c.id and m.account_id = $2
      where c.code = $1`,
    [code, accountId],
    `procurar campanha ${code}`,
  );
  if (rows === null) return { campaign: null, checked: false };
  const row = rows[0];
  if (!row) return { campaign: null, checked: true };
  return {
    campaign: { id: row.id, name: row.name, memberRole: row.member_role },
    checked: true,
  };
}

export interface CampaignInfo {
  code: string;
  name: string;
  createdAt: string;
  /** O papel de quem pediu a lista, pelo vínculo (ADR #19). */
  role: Role;
  /**
   * Se quem pediu é o **dono** da missão. Dono e mestre são coisas diferentes:
   * o dono apaga a missão, o mestre comanda a mesa. Hoje só quem cria é dono,
   * então o lobby só mostra o `×` para ele — e é o servidor quem confere.
   */
  owner: boolean;
}

/**
 * Cria a campanha — o ato deliberado que substituiu a criação de carona.
 *
 * O selo é sorteado aqui e o `unique` do banco decide a corrida: se colidir,
 * sorteia de novo. Algumas tentativas e desiste, porque desistir é honesto —
 * insistir para sempre esconderia uma lista de palavras quebrada.
 *
 * **A criação e o vínculo de mestre são uma instrução só** (ADR #19). São duas
 * linhas em tabelas diferentes, e se a segunda falhasse o dono ficaria sem o
 * papel de mestre na própria missão — um erro silencioso e cruel. O CTE que
 * escreve roda inteiro ou não roda: é o jeito de o banco garantir o que o
 * código não teria como.
 */
export async function createCampaign(
  name: string,
  gmAccountId: string,
): Promise<CampaignInfo | null> {
  if (!dbEnabled) return null;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const code = newSelo();
    const rows = await tryQuery<{ code: string; name: string; created_at: Date; role: Role }>(
      `with nova as (
         insert into campaign (id, code, name, gm_account_id)
         values ($1, $2, $3, $4)
         on conflict (code) do nothing
         returning id, code, name, created_at, gm_account_id
       ), vinculo as (
         -- Sem referência no select final, e mesmo assim executa: no Postgres,
         -- CTE que escreve roda sempre (é o que faz as duas linhas serem juntas).
         insert into membership (account_id, campaign_id, role)
         select gm_account_id, id, 'gm' from nova
          where gm_account_id is not null
         on conflict (account_id, campaign_id) do update set role = 'gm'
       )
       select code, name, created_at, 'gm'::text as role from nova`,
      [uid("camp"), code, name, gmAccountId],
      `criar campanha ${code}`,
    );
    if (rows === null) return null; // banco fora
    const row = rows[0];
    if (row) {
      console.log(`[campanha] criada: ${row.code} "${row.name}" (mestre: conta ${gmAccountId})`);
      return {
        code: row.code,
        name: row.name,
        createdAt: row.created_at.toISOString(),
        role: "gm",
        owner: true,
      };
    }
    console.warn(`[campanha] selo sorteado já existia (${code}), sorteando de novo`);
  }

  console.error("[campanha] 5 sorteios colidiram — a lista do selo está quebrada?");
  return null;
}

/**
 * As missões de quem está logado — as que criou **e as que é membro** (ADR #19).
 *
 * Antes era só "as do dono", e a lista era o lugar de reencontrar o selo
 * perdido. Agora ela é também o caminho do agente: quem entrou numa mesa uma vez
 * não precisa redigitar o selo na sessão seguinte.
 */
export async function listCampaigns(accountId: string): Promise<CampaignInfo[]> {
  if (!dbEnabled) return [];
  const rows = await tryQuery<{
    code: string;
    name: string;
    created_at: Date;
    role: Role;
    owner: boolean;
  }>(
    `select c.code, c.name, c.created_at, m.role, (c.gm_account_id = $1) as owner
       from campaign c
       join membership m
         on m.campaign_id = c.id and m.account_id = $1
      order by c.created_at desc
      limit 50`,
    [accountId],
    "listar campanhas",
  );
  return (rows ?? []).map((r) => ({
    code: r.code,
    name: r.name,
    createdAt: r.created_at.toISOString(),
    role: r.role,
    owner: r.owner,
  }));
}

export type DeleteResult = "ok" | "notfound" | "error";

/**
 * Apaga a missão — o par obrigatório de criar.
 *
 * Só o dono apaga, e a checagem é feita **na consulta** (`gm_account_id = $2`),
 * não em memória: quem não é dono não distingue "não existe" de "não é sua", e
 * assim nem descobre quais selos existem.
 */
export async function deleteCampaign(
  code: string,
  gmAccountId: string,
): Promise<DeleteResult> {
  if (!dbEnabled) return "error";
  const rows = await tryQuery<{ id: string }>(
    `delete from campaign
     where code = $1 and gm_account_id = $2
     returning id`,
    [code, gmAccountId],
    `apagar campanha ${code}`,
  );
  if (rows === null) return "error";
  if (!rows[0]) return "notfound";
  console.log(`[campanha] apagada: ${code}`);
  return "ok";
}

export type RoleResult = "ok" | "notfound" | "account" | "owner" | "error";

/**
 * Dá ou tira o papel de mestre de uma conta numa missão (ADR #22).
 *
 * É o "o mestre pode dar o líder do ato": quem já comanda a mesa outorga o
 * comando a um agente. Quem pode outorgar é **quem é mestre da missão** (dono ou
 * vínculo `gm`) — não é preciso ser o dono, senão um co-mestre não conseguiria
 * montar a própria equipe.
 *
 * Dois limites, e os dois são regra, não esquecimento:
 *
 *  - **o dono nunca é rebaixado**: ele administra a missão (criar/apagar), e
 *    tirar o papel dele o deixaria com a caneta e sem o volante;
 *  - a checagem e a gravação são **uma instrução só**: se o vínculo de quem
 *    outorga sumir no meio do caminho, nada é gravado.
 *
 * O alvo é procurado por nome de conta, e não por id, porque é o nome que a mesa
 * vê no painel — e o `unique` de `lower(name)` garante que ele identifica um só.
 */
export async function setMemberRole(
  code: string,
  actorAccountId: string,
  targetName: string,
  role: Role,
): Promise<RoleResult> {
  if (!dbEnabled) return "error";
  const rows = await tryQuery<{
    campanha: string;
    pode: string;
    alvo: string;
    dono: string;
    gravado: string;
  }>(
    `with campanha as (
       select c.id, c.gm_account_id
         from campaign c
        where c.code = $1
     ), pode as (
       -- Dono ou vínculo de mestre: os dois são "mestre desta missão".
       select 1 as ok
         from campanha c
        where c.gm_account_id = $2
           or exists (
             select 1 from membership m
              where m.campaign_id = c.id and m.account_id = $2 and m.role = 'gm'
           )
     ), alvo as (
       select a.id, (a.id = c.gm_account_id) as dono
         from campanha c, account a
        where lower(a.name) = lower($3)
     ), gravado as (
       insert into membership (account_id, campaign_id, role)
       select alvo.id, campanha.id, $4
         from alvo, campanha, pode
        where alvo.dono = false
       on conflict (account_id, campaign_id) do update set role = excluded.role
       returning account_id
     )
     select (select count(*) from campanha) as campanha,
            (select count(*) from pode) as pode,
            (select count(*) from alvo) as alvo,
            (select count(*) from alvo where dono) as dono,
            (select count(*) from gravado) as gravado`,
    [code, actorAccountId, targetName, role],
    `mudar papel em ${code}`,
  );
  if (rows === null) return "error";
  const r = rows[0];
  if (!r || Number(r.campanha) === 0 || Number(r.pode) === 0) return "notfound";
  if (Number(r.alvo) === 0) return "account";
  // Pedir "gm" para quem já é dono é idempotente: o dono é sempre mestre.
  if (Number(r.dono) > 0) return role === "gm" ? "ok" : "owner";
  if (Number(r.gravado) === 0) return "error";
  console.log(`[campanha] ${targetName} agora é ${role} em ${code}`);
  return "ok";
}

/**
 * Garante o selo sugerido do `ROOM_CODE` — mas **só quando o banco está vazio**
 * (ADR #18).
 *
 * A intenção é o primeiro boot: sem isto, um banco novo recebe todo mundo com
 * "selo desconhecido" e o grupo precisa criar a primeira missão antes de
 * qualquer coisa. A intenção **não** é tornar este selo eterno: se o mestre
 * apagou a missão padrão e já tem outras, ela fica apagada. Um selo que ressuscita
 * a cada restart seria uma surpresa ruim.
 */
export async function ensureDefaultCampaign(code: string): Promise<void> {
  if (!dbEnabled) return;
  const rows = await tryQuery<{ id: string }>(
    `with nova as (
       insert into campaign (id, code, name, gm_account_id)
       select $1, $2, $3, $4
        where not exists (select 1 from campaign)
       on conflict (code) do nothing
       returning id, gm_account_id
     ), vinculo as (
       -- O mestre-semente também entra pelo vínculo, como qualquer criador
       -- (ADR #19): a missão padrão não é um caso especial.
       insert into membership (account_id, campaign_id, role)
       select gm_account_id, id, 'gm' from nova
        where gm_account_id is not null
       on conflict (account_id, campaign_id) do update set role = 'gm'
     )
     select id from nova`,
    [uid("camp"), code, code, defaultGmAccountId],
    `garantir campanha padrao ${code}`,
  );
  if (rows?.[0]) console.log(`[campanha] banco vazio: selo padrao criado (${code})`);
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

interface PersistedMapState {
  cols: number;
  rows: number;
  cell: number;
  offsetX?: number;
  offsetY?: number;
  walls: boolean[][];
  edgeWalls?: string[];
  edgeWindows?: string[];
  fogExplored: number[][];
  actorPositions?: Record<string, { row: number; col: number; facing: Facing }>;
}

interface PersistedScene {
  schemaVersion: number;
  cols: number;
  rows: number;
  cell: number;
  offsetX?: number;
  offsetY?: number;
  bgImage: string | null;
  fogMode: FogMode;
  walls: boolean[][];
  edgeWalls?: string[];
  edgeWindows?: string[];
  fogExplored: number[][];
  actors: PersistedActor[];
  sectors: Sector[];
  savedMaps?: Record<string, PersistedMapState>;
}

export function persistableScene(room: Room): PersistedScene {
  const s = room.scene;
  return {
    schemaVersion: SCENE_SCHEMA,
    cols: s.cols,
    rows: s.rows,
    cell: s.cell,
    offsetX: s.offsetX ?? 0,
    offsetY: s.offsetY ?? 0,
    bgImage: s.bgImage,
    fogMode: s.fogMode,
    walls: s.walls,
    edgeWalls: s.edgeWalls ?? [],
    edgeWindows: s.edgeWindows ?? [],
    fogExplored: s.fogExplored,
    actors: s.actors
      .filter((a) => a.ownerId === null && !room.pcActors.has(a.id))
      .map(({ ownerId: _o, path: _p, ...rest }) => rest),
    sectors: s.sectors,
    savedMaps: s.savedMaps ?? {},
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

  const rows = clamp(numberOr(d.rows, 22), 5, 120);
  const cols = clamp(numberOr(d.cols, 30), 5, 120);
  const scene = createScene();

  scene.rows = rows;
  scene.cols = cols;
  scene.cell = clamp(numberOr(d.cell, 48), 12, 160);
  scene.offsetX = numberOr(d.offsetX, 0);
  scene.offsetY = numberOr(d.offsetY, 0);
  scene.bgImage = typeof d.bgImage === "string" ? d.bgImage : null;
  scene.fogMode = d.fogMode === "hard" ? "hard" : "soft";
  scene.edgeWalls = Array.isArray(d.edgeWalls) ? d.edgeWalls.filter((x): x is string => typeof x === "string") : [];
  scene.edgeWindows = Array.isArray(d.edgeWindows) ? d.edgeWindows.filter((x): x is string => typeof x === "string") : [];

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

  if (d.savedMaps && typeof d.savedMaps === "object") {
    scene.savedMaps = d.savedMaps as Record<string, PersistedMapState>;
  }

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
