/**
 * Utilidades dos testes que precisam de uma **missão descartável** (ADR #18).
 *
 * Desde a entrega 3, selo desconhecido não entra mais — então um teste que
 * inventa `SMOKE-123456` só passa se o banco estiver fora. O caminho normal é
 * criar a missão, usá-la e apagá-la no fim; é isso que estas funções fazem, para
 * o teste não deixar campanha órfã atrás de si.
 *
 * Se não der para criar (banco fora, ou servidor sem conta-semente), devolve um
 * selo inventado e um `cleanup` vazio: nesse modo o servidor não julga selo, e
 * o teste continua valendo — que é justamente o comportamento prometido pelo
 * ADR #17.
 */

import { execFileSync } from "node:child_process";

const USER = process.env.SEED_MASTER_USER ?? "helio";
const PASS = process.env.SEED_MASTER_PASS ?? "123456";

/**
 * Nome da conta descartável dos testes de vínculo (ADR #19).
 *
 * É fixo, e não sorteado, porque não existe rota para apagar conta: uma conta
 * nova por execução encheria a tabela para sempre. Com nome fixo, no máximo uma
 * conta de teste existe — e `deleteTestAccount` tira ela no fim.
 */
export const TEST_ACCOUNT = "agente-teste";
export const TEST_ACCOUNT_PASS = "teste-123456";

export async function api(base, method, path, { body, cookie } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, res };
}

export function cookieOf(res) {
  const all = res.headers.getSetCookie?.() ?? [];
  return all[0] ? all[0].split(";")[0] : "";
}

/** Sessão da conta-semente, ou `null` se o servidor não tem login/conta. */
export async function masterCookie(base) {
  const res = await api(base, "POST", "/api/auth/login", {
    body: { name: USER, password: PASS },
  });
  return res.body?.ok ? cookieOf(res.res) : null;
}

/**
 * Cria a missão do teste e devolve `{ code, ephemeral, cleanup }`.
 *
 * `ephemeral: true` significa que o selo não existe no banco (modo sem banco) e
 * que o `cleanup` não tem nada a fazer.
 */
export async function testCampaign(base, label) {
  const fallback = () => ({
    code: `${label}-${Math.floor(Math.random() * 1e6)}`,
    ephemeral: true,
    cleanup: async () => {},
  });

  const cookie = await masterCookie(base);
  if (!cookie) return fallback();

  const created = await api(base, "POST", "/api/campaigns", {
    body: { name: `Teste ${label}` },
    cookie,
  });
  const code = created.body?.campaign?.code;
  if (created.status !== 201 || !code) return fallback();

  return {
    code,
    ephemeral: false,
    cleanup: async () => {
      await api(base, "DELETE", `/api/campaigns/${code}`, { cookie });
    },
  };
}

/**
 * Cria a conta de teste, ou entra nela se já existir de uma execução anterior.
 *
 * Devolve o cookie. Assim o teste é idempotente sem depender de o banco estar
 * limpo — e o `deleteTestAccount` no fim mantém a tabela limpa.
 */
export async function testAccount(base) {
  const created = await api(base, "POST", "/api/accounts", {
    body: { name: TEST_ACCOUNT, password: TEST_ACCOUNT_PASS },
  });
  if (created.status === 201) return { cookie: cookieOf(created.res), created: true };

  // 409 = o nome já existe (execução anterior que não limpou). Entra nela.
  const login = await api(base, "POST", "/api/auth/login", {
    body: { name: TEST_ACCOUNT, password: TEST_ACCOUNT_PASS },
  });
  if (login.body?.ok) return { cookie: cookieOf(login.res), created: false };

  return { cookie: null, created: false, error: created.body?.error ?? "sem conta" };
}

/**
 * Apaga a conta de teste pelo banco — e, com ela, os vínculos (cascade).
 *
 * É o único ponto dos testes que fala com o banco em vez de falar HTTP, e o
 * motivo é honesto: **não existe rota para apagar conta**. Cadastro entrou na
 * entrega 4, e apagar conta é coisa que mexe em campanha órfã — não se faz de
 * improviso. Quando essa rota existir, isto vira uma chamada HTTP.
 *
 * Falha em silêncio: rodar o teste de outra máquina não pode quebrar por isto. O
 * pior caso é sobrar uma conta chamada `agente-teste`.
 */
export function deleteTestAccount(name = TEST_ACCOUNT) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return;
  const user = process.env.POSTGRES_USER ?? "helio";
  const db = process.env.POSTGRES_DB ?? "helio";
  try {
    execFileSync(
      "docker",
      [
        "exec",
        "helio-postgres",
        "psql",
        "-U",
        user,
        "-d",
        db,
        "-t",
        "-c",
        `delete from account where lower(name) = lower('${name}') returning name`,
      ],
      { stdio: "ignore" },
    );
  } catch {
    console.log(
      `  nota: não deu para apagar a conta de teste "${name}" pelo banco; ela ficou`,
    );
  }
}
