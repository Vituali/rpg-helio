/**
 * Senhas e sessões (ADR #16).
 *
 * Nada de bcrypt, nada de dependência nova: `scrypt` e `HMAC-SHA256` já vêm no
 * `node:crypto`. São ~60 linhas que qualquer um lê.
 *
 * Duas decisões que valem explicação:
 *
 * 1. **`scrypt` assíncrono, não `scryptSync`.** Este processo também serve a
 *    partida, e Node é single-thread: um `scryptSync` de ~100 ms num login
 *    congela a mesa de todo mundo. Um login mal comportado viraria negação de
 *    serviço contra os jogadores.
 * 2. **Sessão sem estado, só assinada.** O token carrega o que precisa e a
 *    assinatura prova que foi o servidor que emitiu. Sem tabela de sessões,
 *    reiniciar o container não desloga ninguém. O preço, que fica dito: não dá
 *    para revogar uma sessão específica — sair apaga o cookie.
 */

import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";

// ── Senha ────────────────────────────────────────────────────────────────────
//
// Formato guardado: `scrypt$N$r$p$salt$hash` (salt e hash em base64). Os
// parâmetros viajam junto de propósito: se um dia endurecerem, as senhas
// antigas continuam verificando com os parâmetros com que foram criadas.

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
const MAX_MEM = 64 * 1024 * 1024;

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, opts, (err, derived) =>
      err ? reject(err) : resolve(derived),
    );
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const opts = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: MAX_MEM };
  const hash = await scryptAsync(plain, salt, KEY_LEN, opts);
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

/** Comparação de tempo constante — errar aqui entregaria a senha por temporização. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = (stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const expected = Buffer.from(hashB64, "base64");
  if (expected.length === 0) return false;

  const got = await scryptAsync(plain, Buffer.from(saltB64, "base64"), expected.length, {
    N,
    r,
    p,
    maxmem: MAX_MEM,
  });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// ── Sessão ───────────────────────────────────────────────────────────────────

const SECRET = (process.env.SESSION_SECRET ?? "").trim();
export const sessionEnabled = SECRET !== "";

/** 30 dias. É um jogo entre amigos, não um internet banking. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface Session {
  /** Conta (ADR #16) — a identidade estável, que sobrevive ao F5 e ao restart. */
  accountId: string;
  name: string;
  /** Emitida em (ms). Ajuda a depurar, não decide nada. */
  iat: number;
  /** Expira em (ms). */
  exp: number;
}

const b64url = (buf: Buffer): string => buf.toString("base64url");

function sign(body: string): string {
  return b64url(createHmac("sha256", SECRET).update(body).digest());
}

export function signSession(account: { id: string; name: string }): string {
  if (!sessionEnabled) throw new Error("SESSION_SECRET não configurada");
  const now = Date.now();
  const payload: Session = {
    accountId: account.id,
    name: account.name,
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${sign(body)}`;
}

/**
 * Lê e confere uma sessão. Devolve `null` para qualquer coisa suspeita —
 * assinatura errada, formato errado, expirada, segredo ausente. Quem chama não
 * precisa tratar erro.
 */
export function readSession(token: string | undefined | null): Session | null {
  if (!sessionEnabled || !token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(body));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<Session>;
    if (typeof parsed.accountId !== "string" || parsed.accountId === "") return null;
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return {
      accountId: parsed.accountId,
      name: typeof parsed.name === "string" ? parsed.name : "Anônimo",
      iat: typeof parsed.iat === "number" ? parsed.iat : 0,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

/** Nome do cookie. Um lugar só, para o cliente e o servidor não divergirem. */
export const SESSION_COOKIE = "helio_session";

/** `Secure` só quando há HTTPS — em `:80` local não haveria como mandar o cookie. */
export function sessionCookie(token: string, secure: boolean): string {
  const bits = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const bits = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}
