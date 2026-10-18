# Stack

Documento de alvo: **como o projeto fica**, não como ele está em cada commit. O que existe hoje está
em `ARQUITETURA.md`; o que falta, em `ROADMAP.md`; o que está em andamento, em `KANBAN.md`.

Legenda: ✅ decidido · 🔜 recomendado (confirmar) · ⏳ só quando fizer sentido

---

## O desenho em uma tela

```
                    Internet
                        │
              ┌─────────┴─────────┐
              │  Cloudflare Tunnel │   ← sem porta aberta, IP de casa escondido
              └─────────┬─────────┘
                        │
                 ┌──────┴──────┐
                 │   Caddy     │   ← único ponto público; TLS; estático + proxy
                 └──┬───────┬──┘
        estático    │       │  /socket.io
                    │       │
    ┌───────────────┴──┐  ┌─┴──────────────┐
    │ web/ (site+wiki) │  │ client/ (mesa) │
    │ Next, estático   │  │ Vite SPA       │
    └──────────────────┘  └───────┬────────┘
                                  │ Socket.IO (estado autoritativo)
                          ┌───────┴────────┐      ┌────────────┐
                          │ server/        │──────│ Postgres   │
                          │ Node + Socket  │      │ (volume)   │
                          └───────┬────────┘      └────────────┘
                                  │
                          ┌───────┴────────┐
                          │ shared/        │  ← regras puras, usadas por todos
                          └────────────────┘
```

Três runtime e um pacote de regras. Nada mais.

---

## Monorepo

| Item | Decisão |
|---|---|
| Gerenciador | ✅ **npm** (o que já usam) |
| Workspaces | 🔜 `package.json` na raiz com `workspaces`, **no dia em que o segundo app entrar** |
| Node | ✅ **22 LTS** em tudo (mesma versão no `Dockerfile`) |
| TypeScript | ✅ **6.x**, `strict`, `verbatimModuleSyntax` |
| `shared/` | Hoje é alias de tsconfig; 🔜 vira **pacote de verdade** quando o `web/` existir |

**Por que só agora não:** manter `shared/` como alias funciona enquanto todos os consumidores
resolvem `paths` (Vite e `tsx`). Um bundler próprio (Next) não resolve do mesmo jeito — então o
workspace real entra junto com o segundo app, não antes.

---

## `shared/` — as regras puras

- ✅ TypeScript puro. **Sem React, sem socket, sem banco.** Se precisa de contexto de execução, não
  pertence aqui.
- ✅ Tipos, constantes, grade, visão (LOS), pathfinding, id.
- 🔜 **Schemas de validação (Zod)** dos payloads do protocolo — os mesmos usados pelo cliente para
  montar e pelo servidor para validar.
- 🔜 **Esquema da ficha** (regras customizadas), versionado com `schemaVersion`.
- 🔜 **Motor de dados** (rolagem) como função pura — cliente pré-visualiza, servidor decide.

O critério: **se o cliente e o servidor precisam concordar, mora aqui.** Foi assim com `visibleCellsFrom`,
e é o que evita as duas implementações divergirem.

---

## `server/` — autoritativo

| Camada | Decisão |
|---|---|
| Runtime | ✅ **Node 22 + TypeScript via `tsx`** — sem passo de build |
| Tempo real | ✅ **Socket.IO**, servidor autoritativo, snapshot completo `room:state` |
| HTTP/REST | 🔜 **Fastify** ou **Hono**, enxuto — contas, campanhas, fichas, uploads, `/health` |
| Framework de aplicação | ✅ **nenhum**. NestJS foi avaliado e recusado (ver abaixo) |
| Banco | ✅ **Postgres** via `pg` |
| Acesso a dados | 🔜 **Drizzle** ou **Kysely** (SQL tipado) — **não Prisma** |
| Validação | 🔜 **Zod** na fronteira: socket e HTTP |
| Migrations | 🔜 SQL numerado + runner pequeno, desde a primeira tabela |
| Identidade | ✅ conta + sessão assinada (cookie `HttpOnly`); papel de mestre pelo **vínculo** com a missão — o `GM_KEY` é legado |

Organização por recurso, não por camada técnica:

```
server/src/
├─ realtime/   handlers de socket (o que existe hoje)
├── http/       REST + /health
├─ dados/      repositórios do Postgres
└─ dominio/    orquestração (as regras puras seguem em shared/)
```

**Por que não NestJS:** o servidor não é CRUD, é uma máquina de estado pequena e quente. Nest brilha
em muitos recursos com muitos controllers; `@nestjs/websockets` é um embrulho fino sobre o mesmo
Socket.IO. Custa DI, decorators e metadata, e troca um arquivo que qualquer um lê pelo protocolo
inteiro por indireção. Auto-hospedando no PC de casa, menos peça móvel é melhor.

**Por que não Prisma:** ele carrega um binário de engine (`query-engine`) que precisa de permissão de
escrita em runtime, e o container roda com filesystem somente-leitura e sem root (ADR #15). Drizzle e
Kysely são SQL tipado em TypeScript puro — sem binário, sem daemon de codegen.

**Regra estrutural:** **tempo real e CRUD ficam em módulos separados.** Assim a escolha de framework
de um não encosta no outro, e a decisão continua aberta para sempre.

---

## `client/` — a mesa

| Item | Decisão |
|---|---|
| Build | ✅ **Vite** |
| UI | ✅ **React 19** + TypeScript |
| Estado | ✅ **Zustand** (`gameStore` + `netStore`), fora da árvore do React |
| Desenho | ✅ **Canvas 2D** com loop em `requestAnimationFrame` |
| Rede | ✅ **`socket.io-client`** atrás do adapter em `net/` |
| Roteamento | ✅ **nenhum** — a mesa é uma tela. Um router só se houver mais de uma |
| SSR | ✅ **nenhum** |
| Deploy | ✅ estático, servido pelo Caddy em `mesa.<domínio>` |

**Por que não Next aqui:** o canvas não é o problema — canvas funciona em qualquer lugar. O problema é
que SSR não tem o que renderizar (é uma tela interativa atrás de um lobby) e o WebSocket de vida longa
briga com o modelo do Next; você pagaria o Next sem usar o Next.

**O que realmente importa num app de canvas já está resolvido:** loop de render fora do React, estado
sem re-render em cascata, lógica agnóstica em `shared/` e renderizador substituível (procedural + PNG,
trocável por WebGL/Pixi sem tocar na regra). O React é só a casca — **não há lock-in a temer.**

---

## `web/` — site público e wiki ⏳

| Item | Decisão |
|---|---|
| Framework | 🔜 **Next.js** (App Router) com **export estático** |
| Conteúdo | 🔜 **MDX versionado no repo** (landing, wiki, docs, changelog) |
| Busca | 🔜 índice client-side (Pagefind) — sem servidor |
| Runtime em produção | ✅ **nenhum** — sai estático, servido pelo Caddy |
| Deploy | `<domínio>` e `wiki.<domínio>` |

**Por que Next e não Astro:** tecnicamente o Astro é melhor para conteúdo (ilhas, quase zero JS). Mas
vocês já são React, um painel administrativo vai existir, e há reuso de componentes. Coerência de time
pesa mais que a diferença de performance, que num site de conteúdo é irrelevante.

**A regra que evita o pior erro:** **conteúdo ≠ aplicação.** Wiki é texto versionado em git (revisão
por PR, histórico no git, SEO de graça). Campanha e ficha são banco. Wiki dentro do Postgres perde
revisão, transforma edição em CRUD e cria problema de SEO.

---

## Banco de dados

**✅ Postgres.** O SQLite foi descartado: mais de um serviço (servidor do jogo + API do site) vai
escrever, e arquivo único compartilhado entre containers é atrito garantido. Como já rodam Compose, o
Postgres custa **um serviço no arquivo**.

| Uso | Forma |
|---|---|
| **Cena** (mapa, paredes, fog, tokens, setores) | **JSONB**, um registro por sala |
| **Ficha de personagem** | **JSONB** com `schemaVersion` dentro |
| Conta, campanha, vínculo jogador↔campanha, permissão | Tabelas relacionais |

**A gravação da cena é com debounce.** O servidor transmite a cena inteira a cada mudança; gravar cada
uma é amplificação de escrita por nada. A cena viva fica **em memória** (como hoje) e o snapshot vai
para o banco a cada N segundos se mudou. É o detalhe que separa "funciona" de "o banco virou gargalo".

**O banco é assunto exclusivo do servidor.** O cliente nunca fala com ele — passa pelo socket. É essa
fronteira que permite evoluir o banco sem tocar em `client/` nem em `shared/`.

**Backup:** `pg_dump` agendado + o volume. Campanha de RPG é dado precioso.

---

## Identidade e segurança

| Item | Hoje | Alvo |
|---|---|---|
| Quem é você | id do socket | ✅ **sessão assinada** (cookie `HttpOnly`, `SameSite=Lax`, `Secure` em HTTPS); convidado continua sendo o id do socket |
| Entrar como mestre | `GM_KEY` (senha única) | ✅ **vínculo com a missão** (`membership.role`); o `GM_KEY` é legado e sai quando houver recuperação de senha |
| Entrar como jogador | livre | ✅ livre como convidado; com conta, o **cadastro** é aberto com freio e interruptor |
| Papéis | `gm` \| `player` | 🔜 **RBAC**: papel do vínculo já vale na mesa; falta permissão por token e promover um agente a mestre |
| Regras de jogo | ✅ servidor decide | mantém |
| Limite de taxa | ✅ token bucket | mantém |
| Origem | ✅ só mesma origem | mantém |
| Container | ✅ não-root, read-only, sem capabilities | mantém |

**Subdomínios, não caminhos** — cookie de sessão em `.domínio` faz login valer no site e na mesa:

```
<domínio>        → web/ (site + wiki, estático)
mesa.<domínio>   → client/ (a mesa)  +  /socket.io → server/
```

**Identidade é o alicerce.** Hoje é o id do socket, e isso está embaixo de três coisas: reconexão
(S4), RBAC (Fase 4) e contas do site. É o item que mais rende se for feito cedo, porque tudo que for
escrito assumindo "socket id = identidade" terá de ser revisitado.

---

## Testes

| Onde | Como |
|---|---|
| `shared/` | ✅ `node:test` (zero dependência) — colisão, LOS, pathfinding, validação |
| `server/` | ✅ smoke de ponta a ponta com Socket.IO real (`server/scripts/smoke.mjs`), 19 checagens, rodando local **e** contra a URL pública |
| `client/` | ⏳ Vitest no store, se valer a pena |
| CI | ⏳ GitHub Actions: typecheck + testes do `shared/` + smoke, quando o repo for para o GitHub |

O smoke é o teste que mais pega regressão aqui, porque atravessa a pilha inteira (socket → validação →
broadcast). Ele já provou duas correções de segurança.

---

## Operação e deploy

- ✅ **Docker Compose**: `caddy` + `app` + `cloudflared` (profile `tunnel`), e ⏳ `postgres` e `web`.
- ✅ **Um comando**: subir, logs, parar. Sem passo de build para o servidor.
- ✅ **Cloudflare Tunnel** — nenhuma porta de entrada, IP de casa escondido, HTTPS na borda. Port
  forwarding, `sslip.io` e reserva de IP no DHCP estão **fechados como não faremos** (ADR #14).
- ✅ IPv6 global **fechado** (ADR #13).
- ✅ `/health` + healthcheck no Compose; logs no stdout.
- 🔜 Domínio + **Cloudflare Access** (grátis até 50 usuários) quando houver contas.
- ⏳ CI/CD e imagem em registry.

---

## O que NÃO usamos, e por quê

| Recusado | Motivo |
|---|---|
| **NestJS** | Servidor é máquina de estado quente, não CRUD. Embrulho fino sobre o mesmo Socket.IO |
| **Next.js na mesa** | SSR sem o que renderizar + atrito com WebSocket de vida longa |
| **Astro** | Melhor para conteúdo, mas o Next unifica o ecossistema React e o painel admin |
| **SQLite** | Mais de um serviço vai escrever no banco |
| **Prisma** | Binário de engine precisa de escrita em runtime; o container é read-only e sem root |
| **Redux** | Zustand resolve sem cerimônia |
| **Firebase** | ADR #2 — self-hosted por decisão |
| **Colyseus** | ADR #1 — Socket.IO por decisão |
| **SSR na mesa** | Nada a renderizar no servidor |

---

## O que ainda está em aberto

1. 🔜 **Fastify ou Hono** para o REST — decidir quando a primeira rota existir.
2. 🔜 **Drizzle ou Kysely** — decidir com a primeira tabela.
3. 🔜 **Nome do projeto e domínio** — trava `SITE_ADDRESS`, Caddy e cookies.
4. ⏳ **Publicar o repositório** — destrava CI e o Project board.
5. ⏳ **Voz** (WebRTC): malha serve até ~5 pessoas; SFU (LiveKit) se crescer. Separado do servidor de
   jogo — o Socket.IO é só a sinalização.

---

## Ordem de construção

O alvo acima não é um plano de execução. A ordem é:

1. **A mesa jogável** — é o produto. Fog por jogador, fichas, dados e chat são o que faz alguém jogar.
2. **Identidade estável** — sessão assinada. Site, reconexão e RBAC reusam.
3. **Postgres + contas + campanhas** — onde a campanha passa a sobreviver.
4. **Site público** (landing), e **depois** a wiki — conteúdo é trabalho contínuo, não arquitetura.
5. **RBAC** — quando o convite e o papel passarem a importar.

O erro a evitar: construir o site público antes da mesa estar boa.
