/**
 * Rotas HTTP do servidor (ADR #16, #18 e #19).
 *
 * Duas famílias: **auth** (entrar, sair, quem sou eu, criar conta) e
 * **campanhas** (criar, listar e apagar missões) — mais o **painel do
 * administrador** (ADR #23), que só lista contas e troca senha. O jogo em si não
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
import { createAccount, findAccountByName, listAccounts, setAccountPassword } from "./accounts.js";
import { roleChanged } from "./live.js";
import { normalizeCode } from "./selo.js";
import {
  createCampaign,
  deleteCampaign,
  listCampaigns,
  setMemberRole,
  type CampaignInfo,
} from "./store.js";
import type { Session } from "./auth.js";

/** Teto do corpo de uma requisição de auth. Nome e senha não passam de 200 bytes. */
const MAX_BODY = 4 * 1024;

/**
 * Cadastro aberto? `REGISTRATION=closed` fecha a porta (ADR #19).
 *
 * Existe porque cadastro aberto é decisão de agora, não para sempre: quando o
 * grupo todo tiver conta, fechar é uma variável de ambiente e um restart. A
 * alternativa — tela de administração para aprovar conta — seria muito mais
 * código para um problema que dura uma tarde.
 */
export const registrationOpen =
  (process.env.REGISTRATION ?? "open").trim().toLowerCase() !== "closed";

/**
 * A conta de administração (ADR #23).
 *
 * **É o nome, não um papel.** O painel existe para uma tarefa só — trocar senha,
 * já que não há recuperação — e transformar isso num papel exigiria coluna nova,
 * migration e uma tela para outorgar. O nome resolve, e tem uma consequência que
 * fica dita: quem tem a conta com este nome manda. Por isso a senha dela é a
 * senha mais importante do servidor, e o cadastro deve estar fechado quando
 * ninguém novo estiver entrando.
 *
 * `ADMIN_ACCOUNT` permite trocar o nome (e vazio desliga o painel); o padrão é
 * `admin`, que é o que está escrito no DEPLOY.
 */
export const adminAccount = (process.env.ADMIN_ACCOUNT ?? "admin").trim().toLowerCase();

export function isAdminAccount(name: string): boolean {
  return adminAccount !== "" && name.trim().toLowerCase() === adminAccount;
}

// ── Limites de tentativas ────────────────────────────────────────────────────
//
// Global, e não por IP, por um motivo concreto: atrás do túnel e do Docker,
// TODO mundo chega com o mesmo IP de origem (o gateway do compose). Um limite
// por IP viraria um limite compartilhado — o primeiro a abusar travaria o
// grupo inteiro. Um teto global é honesto sobre o que ele é.
//
// Serve para o que importa aqui: `scrypt` é caro de propósito (~50 ms), e o
// mesmo processo serve a partida. Sem teto, um cliente em loop de login
// entupiria o pool de threads e a mesa sentiria.
//
// São **dois baldes separados** (entrar e criar conta) de propósito: uma rajada
// de cadastros não pode trancar o login de quem só quer jogar.
function rateLimiter(perMinute: number): () => boolean {
  let start = Date.now();
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - start >= 60_000) {
      start = now;
      count = 0;
    }
    count += 1;
    return count <= perMinute;
  };
}

const loginAllowed = rateLimiter(Number(process.env.LOGIN_PER_MINUTE ?? 20));

/**
 * Cadastros por minuto (padrão: 10).
 *
 * Folgado o bastante para o grupo se cadastrando junto numa chamada, e o que um
 * abuso consegue com isto é criar contas **que não abrem mesa nenhuma**: entrar
 * ainda exige o Selo, e papel de mestre ainda exige vínculo. O freio é contra
 * entupir o `scrypt`, não contra invasão.
 */
const registerAllowed = rateLimiter(Number(process.env.REGISTER_PER_MINUTE ?? 10));

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

// ── Validação do cadastro (ADR #19) ──────────────────────────────────────────
//
// Devolvem a frase que o lobby mostra, ou `null` se estiver tudo bem. Ficam
// aqui, e não no banco, porque são regra de entrada — o banco não deve ter
// opinião sobre o que é um nome aceitável.

/** Nome de conta: precisa dar para chamar a pessoa, e nada de caractere invisível. */
function nameProblem(name: string): string | null {
  if (name.length < 2) return "O nome precisa de pelo menos 2 caracteres.";
  if (name.length > 24) return "O nome pode ter no máximo 24 caracteres.";
  if (/[\u0000-\u001f\u007f]/.test(name)) return "O nome não pode ter caracteres de controle.";
  return null;
}

/**
 * Senha: mínimo 6 (a do mestre-semente tem 6) e teto de 200.
 *
 * O teto existe porque `scrypt` é caro e roda nesta mesma thread: uma senha de
 * megabytes por requisição é negação de serviço de graça. Não há exigência de
 * símbolo nem de maiúscula — o que protege a conta aqui é o `scrypt`, não a
 * criatividade de quem digita.
 */
function passwordProblem(password: string): string | null {
  if (password.length < 6) return "A senha precisa de pelo menos 6 caracteres.";
  if (password.length > 200) return "A senha pode ter no máximo 200 caracteres.";
  return null;
}

// ── Rotas ────────────────────────────────────────────────────────────────────

function sessionOf(req: IncomingMessage): Session | null {
  return readSession(cookieValue(req.headers.cookie, SESSION_COOKIE));
}

/**
 * Trata as rotas HTTP do servidor. Devolve `false` quando o caminho não é daqui
 * — quem chamou decide o que fazer (hoje: 404).
 *
 * **Tudo aqui vive sob `/api`**, e isso é contrato, não estilo: é o que permite
 * ao Caddy mandar `/api/*` para o app sem enumerar rota por rota. Rota nova
 * dentro do prefixo não tem como ser esquecida; fora dele, não existe (e o
 * `/api` jamais chega no servidor de arquivos, então rota que falta vira 404
 * de verdade em vez de `index.html` com status 200 — erro que já custou duas
 * depurações).
 *
 * São duas famílias: **auth** (ADR #16) e **campanhas** (ADR #18). O jogo em si
 * não passa por aqui.
 */
export async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? "";
  const full = url.split("?")[0];
  if (!full.startsWith("/api/")) return false;
  const path = full.slice("/api".length);
  const method = req.method ?? "GET";
  const secure = isSecure(req);

  if (path === "/auth/me" && method === "GET") {
    const session = sessionOf(req);
    // `signup` vai junto de propósito: a página de entrada precisa saber se pode
    // oferecer "criar conta" ANTES de a pessoa preencher o formulário (ADR #19).
    //
    // E o cadastro também depende de haver sessão: sem `SESSION_SECRET` a rota
    // de contas responde 503, então oferecer o botão seria prometer o que o
    // servidor recusa.
    const signup = registrationOpen && sessionEnabled;
    if (!session) {
      send(res, 200, { ok: false, signup });
      return true;
    }
    send(res, 200, {
      ok: true,
      account: {
        id: session.accountId,
        name: session.name,
        admin: isAdminAccount(session.name),
      },
      signup,
    });
    return true;
  }

  if (path === "/auth/logout" && method === "POST") {
    // Sem estado no servidor: sair é o cliente esquecer o cookie. Ver ADR #16 —
    // revogar uma sessão específica exigiria tabela, e não vale o preço agora.
    header(res, clearSessionCookie(secure));
    send(res, 200, { ok: true });
    return true;
  }

  // ── Criar conta (ADR #19) ──
  //
  // Quem cria já sai logado: o cadastro termina com a mesma sessão do login, e
  // não existe tela de "agora entre com o que você acabou de digitar".
  if (path === "/accounts" && method === "POST") {
    if (!sessionEnabled) {
      send(res, 503, { ok: false, error: "Sessão desligada neste servidor." });
      return true;
    }
    if (!registrationOpen) {
      send(res, 403, { ok: false, error: "Cadastro fechado neste servidor." });
      return true;
    }
    if (!registerAllowed()) {
      send(res, 429, { ok: false, error: "Cadastros demais agora. Espere um minuto." });
      return true;
    }

    const body = await readJson(req);
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 24) : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const problem = nameProblem(name) ?? passwordProblem(password);
    if (problem) {
      send(res, 400, { ok: false, error: problem });
      return true;
    }

    const created = await createAccount(name, password);
    if (created === null) {
      send(res, 503, { ok: false, error: "Banco indisponível: não deu para criar a conta." });
      return true;
    }
    if (created === "taken") {
      // Aqui o nome repetido é dito na cara, e é a exceção entre as rotas de
      // conta: no login a resposta é cega para não entregar quem existe. Não dá
      // para esconder no cadastro — o `unique` recusaria de qualquer forma, e
      // uma mensagem genérica só faria a pessoa tentar de novo à toa.
      console.log(`[conta] nome ja tomado: ${name}`);
      send(res, 409, { ok: false, error: "Esse nome já tem dono. Escolha outro." });
      return true;
    }

    header(res, sessionCookie(signSession(created), secure));
    console.log(`[conta] criada: ${created.name}`);
    send(res, 201, {
      ok: true,
      account: {
        id: created.id,
        name: created.name,
        admin: isAdminAccount(created.name),
      },
    });
    return true;
  }

  // ── Painel do administrador (ADR #23) ──
  //
  // Duas rotas, e nada mais: listar contas e definir senha. O resto que parecia
  // "administração" já tem lugar melhor — papel é vínculo (ADR #22), apagar
  // missão é do dono (ADR #18), e apagar conta deixaria missão órfã.
  //
  // A checagem é aqui, não no cliente: a tela só esconde o link, quem decide é
  // o servidor. O nome vem do cookie assinado, então não há o que forjar sem a
  // `SESSION_SECRET`.
  if (path === "/admin/accounts" || path.startsWith("/admin/accounts/")) {
    const session = sessionOf(req);
    if (!session) {
      send(res, 401, { ok: false, error: "Entre com sua conta para isso." });
      return true;
    }
    if (!isAdminAccount(session.name)) {
      console.log(`[admin] recusado para "${session.name}"`);
      send(res, 403, { ok: false, error: "Só a conta de administração." });
      return true;
    }

    if (path === "/admin/accounts" && method === "GET") {
      const accounts = await listAccounts();
      if (accounts === null) {
        send(res, 503, { ok: false, error: "Banco indisponível: sem lista de contas." });
        return true;
      }
      send(res, 200, { ok: true, admin: adminAccount, accounts });
      return true;
    }

    if (path.startsWith("/admin/accounts/") && path.endsWith("/password") && method === "POST") {
      const name = decodeURIComponent(
        path.slice("/admin/accounts/".length, -"/password".length),
      ).trim();
      const body = await readJson(req);
      const password = typeof body?.password === "string" ? body.password : "";
      if (name === "") {
        send(res, 400, { ok: false, error: "Diga a conta." });
        return true;
      }
      const problem = passwordProblem(password);
      if (problem) {
        send(res, 400, { ok: false, error: problem });
        return true;
      }

      const result = await setAccountPassword(name, password);
      if (result === "error") {
        send(res, 503, { ok: false, error: "Banco indisponível: não deu para trocar a senha." });
        return true;
      }
      if (result === "notfound") {
        send(res, 404, { ok: false, error: "Conta não encontrada." });
        return true;
      }
      console.log(`[admin] senha trocada: ${name} (por ${session.name})`);
      send(res, 200, { ok: true, name });
      return true;
    }
  }

  // ── Campanhas: criar e listar são de quem tem conta (ADR #18) ──
  if (path === "/campaigns" && (method === "GET" || method === "POST")) {
    const session = sessionOf(req);
    if (!session) {
      send(res, 401, { ok: false, error: "Entre com sua conta para isso." });
      return true;
    }

    if (method === "GET") {
      const campaigns = await listCampaigns(session.accountId);
      send(res, 200, { ok: true, campaigns });
      return true;
    }

    const body = await readJson(req);
    const raw = typeof body?.name === "string" ? body.name.trim().slice(0, 40) : "";
    // Nome vazio não é erro: a missão passa a existir e o mestre renomeia
    // depois. O que não pode é o selo depender do nome (ADR #18).
    const name = raw === "" ? "Missão sem nome" : raw;
    const campaign: CampaignInfo | null = await createCampaign(name, session.accountId);
    if (!campaign) {
      send(res, 503, { ok: false, error: "Banco indisponível: não deu para criar a missão." });
      return true;
    }
    console.log(`[campanha] ${session.name} criou ${campaign.code}`);
    send(res, 201, { ok: true, campaign });
    return true;
  }

  if (path.startsWith("/campaigns/") && method === "DELETE") {
    const session = sessionOf(req);
    if (!session) {
      send(res, 401, { ok: false, error: "Entre com sua conta para isso." });
      return true;
    }
    const code = normalizeCode(decodeURIComponent(path.slice("/campaigns/".length)));
    const result = await deleteCampaign(code, session.accountId);
    if (result === "error") {
      send(res, 503, { ok: false, error: "Banco indisponível: não deu para apagar." });
      return true;
    }
    if (result === "notfound") {
      // Mesma resposta para "não existe" e "não é sua": quem não é dono não
      // precisa saber quais selos existem.
      send(res, 404, { ok: false, error: "Missão não encontrada." });
      return true;
    }
    send(res, 200, { ok: true });
    return true;
  }

  // ── Papel na missão: dar e tirar o mestre (ADR #22) ──
  //
  // A rota grava o vínculo e avisa a mesa viva (`roleChanged`): quem foi
  // promovido comanda o mapa na hora, sem F5. Quem pode outorgar é quem já é
  // mestre ali (dono ou vínculo) — ver `setMemberRole`.
  if (path.startsWith("/campaigns/") && path.endsWith("/role") && method === "POST") {
    const session = sessionOf(req);
    if (!session) {
      send(res, 401, { ok: false, error: "Entre com sua conta para isso." });
      return true;
    }

    const code = normalizeCode(
      decodeURIComponent(path.slice("/campaigns/".length, -"/role".length)),
    );
    const body = await readJson(req);
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 24) : "";
    const role =
      body?.role === "gm" ? "gm" : body?.role === "player" ? "player" : null;
    if (code === "" || name === "" || role === null) {
      send(res, 400, { ok: false, error: "Diga a conta e o papel (gm ou player)." });
      return true;
    }

    const result = await setMemberRole(code, session.accountId, name, role);
    if (result === "notfound") {
      // Mesma resposta de sempre: quem não manda aqui não descobre quais selos
      // existem nem quem é mestre de quê.
      send(res, 404, { ok: false, error: "Missão não encontrada." });
      return true;
    }
    if (result === "account") {
      send(res, 400, { ok: false, error: "Conta não encontrada." });
      return true;
    }
    if (result === "owner") {
      send(res, 400, {
        ok: false,
        error: "O dono da missão é sempre mestre. Não dá para rebaixar.",
      });
      return true;
    }
    if (result === "error") {
      send(res, 503, { ok: false, error: "Banco indisponível: não deu para mudar o papel." });
      return true;
    }

    roleChanged({ code, name, role });
    send(res, 200, { ok: true, name, role });
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
    send(res, 200, {
      ok: true,
      account: {
        id: account.id,
        name: account.name,
        admin: isAdminAccount(account.name),
      },
    });
    return true;
  }

  return false;
}
