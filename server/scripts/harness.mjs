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

const USER = process.env.SEED_MASTER_USER ?? "helio";
const PASS = process.env.SEED_MASTER_PASS ?? "123456";

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
