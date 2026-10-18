/**
 * Rotas HTTP do servidor (ADR #16).
 *
 * Por enquanto só autenticação: entrar, sair e "quem sou eu". O jogo em si não
 * passa por aqui — continua no Socket.IO. A divisão é deliberada: tempo real e
 * CRUD em módulos separados, para trocar um sem encostar no outro.
 *
 * O cookie é o ponto todo: como o Socket.IO lê os cookies do handshake, a
 * identidade chega na conexão sem inventar mensagem nova.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  cookieValue,
  hashPassword,
  readSession,
  sessionCookie,
  sessionEnabled,
  signSession,
  verifyPassword,
} from "./auth.js";
import { findAccountByName } from "./accounts.js";

/** Teto do corpo de uma requisição de auth. Nome e senha não passam de 200 bytes. */
const MAX_BODY = 4 * 1024;

// ── Limite de tentativas de login ────────────────────────────────────────────
//
// Global, e não por IP, por um motivo concreto: atrás do túnel e do Docker,
// TODO mundo chega com o mesmo IP de origem (o gateway do compose). Um limite
// por IP viraria um limite compartilhado — o primeiro a abusar travaria o
// grupo inteiro. Um teto global é honesto sobre o que ele é.
//
// Serve para o que importa aqui: `scrypt` é caro de propósito (~50 ms), e o
// mesmo processo serve a partida. Sem teto, um cliente em loop de login
// entupiria o pool de threads e a mesa sentiria.
const LOGIN_PER_MINUTE = Number(process.env.LOGIN_PER_MINUTE ?? 20);
let windowStart = Date.now();
let windowCount = 0;

function loginAllowed(): boolean {
  const now = Date.now();
  if (now - windowStart >= 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount <= LOGIN_PER_MINUTE;
}

/**
 * Hash descartável, conferido quando a conta NÃO existe.
 *
 * Sem isto, "senha errada" responderia em 1 ms e "usuário não existe" em 50 ms
 * — e a diferença diria quais nomes existem. O relógio não deve ser um canal.
 */
const dummyHash = hashPassword(randomBytes(16).toString("hex"));

// ── Utilidades ───────────────────────────────────────────────────────────────

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

function header(res: ServerResponse, value: string): void {
  res.setHeader("set-cookie", value);
}

/**
 * `secure` do cookie.
 *
 * A pegadinha: o Caddy termina o TLS e repassa a requisição em HTTP puro, então
 * o `X-Forwarded-Proto` que chega no app é `http` **mesmo quando o navegador
 * falou HTTPS**. Se dependesse só dele, a sessão pública sairia sem `Secure` —
 * e um cookie de sessão sem `Secure` viaja em HTTP, que é como se rouba sessão.
 *
 * Então olhamos também para a borda da Cloudflare, que é por onde o tráfego
 * público entra (ADR #14) e que marca toda requisição que passou por ela.
 *
 * Errar para o lado do `Secure` é inofensivo — na pior hipótese o navegador
 * deixa de mandar o cookie numa conexão desprotegida, que é exatamente o que
 * queremos. Errar para o outro lado é o que expõe a sessão. Acesso direto na LAN
 * (`http://192.168.x.x`) não tem marca nenhuma e continua funcionando.
 */
function isSecure(req: IncomingMessage): boolean {
  const proto = req.headers["x-forwarded-proto"];
  const value = Array.isArray(proto) ? proto[0] : proto;
  if (typeof value === "string" && value.split(",")[0].trim() === "https") {
    return true;
  }
  const visitor = req.headers["cf-visitor"];
  if (typeof visitor === "string" && /"scheme"\s*:\s*"https"/.test(visitor)) {
    return true;
  }
  return typeof req.headers["cf-ray"] === "string";
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY) return null;
    chunks.push(buf);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ── Rotas ────────────────────────────────────────────────────────────────────

/**
 * Trata as rotas de auth. Devolve `false` quando o caminho não é daqui — quem
 * chamou decide o que fazer (hoje: 404).
 */
export async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? "";
  const path = url.split("?")[0];
  const method = req.method ?? "GET";
  const secure = isSecure(req);

  if (path === "/auth/me" && method === "GET") {
    const session = readSession(cookieValue(req.headers.cookie, SESSION_COOKIE));
    if (!session) {
      send(res, 200, { ok: false });
      return true;
    }
    send(res, 200, { ok: true, account: { id: session.accountId, name: session.name } });
    return true;
  }

  if (path === "/auth/logout" && method === "POST") {
    // Sem estado no servidor: sair é o cliente esquecer o cookie. Ver ADR #16 —
    // revogar uma sessão específica exigiria tabela, e não vale o preço agora.
    header(res, clearSessionCookie(secure));
    send(res, 200, { ok: true });
    return true;
  }

  if (path === "/auth/login" && method === "POST") {
    if (!sessionEnabled) {
      send(res, 503, { ok: false, error: "Sessão desligada neste servidor." });
      return true;
    }
    if (!loginAllowed()) {
      send(res, 429, { ok: false, error: "Tentativas demais. Espere um minuto." });
      return true;
    }

    const body = await readJson(req);
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 24) : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (name === "" || password === "") {
      send(res, 400, { ok: false, error: "Informe usuário e senha." });
      return true;
    }

    const account = await findAccountByName(name);
    // A mensagem é a mesma nos dois casos: não entregamos quais nomes existem.
    const ok = account
      ? await verifyPassword(password, account.password_hash)
      : await verifyPassword(password, await dummyHash);

    if (!ok || !account) {
      console.log(`[entrada] login recusado para "${name}"`);
      send(res, 401, { ok: false, error: "Usuário ou senha inválidos." });
      return true;
    }

    header(res, sessionCookie(signSession(account), secure));
    console.log(`[entrada] conta entrou: ${account.name}`);
    send(res, 200, { ok: true, account: { id: account.id, name: account.name } });
    return true;
  }

  return false;
}
