# CODE_MAP.MD — MAPA AUTOMATIZADO DO CÓDIGO (HELIO)

> Gerado automaticamente por `tools/docgen.mjs` em: **2026-10-24T22:28:20.089Z**.
> Não edite manualmente. Para atualizar este arquivo, execute: `node tools/docgen.mjs`.

## Pacote: Shared (`shared/src`)

### `shared/src/constants.ts`
> Sem descrição de cabeçalho.

**Exports principais:**
- `const DEFAULT_COLS`
- `const DEFAULT_ROWS`
- `const DEFAULT_CELL`
- `const MINIMAP_W`
- `const MINIMAP_H`
- `const FOG_NONE`
- `const FOG_SEEN`
- `const FOG_VIS`
- `const FOG_REVEAL`
- `const WALK_SPEED`
- *...e mais 7 declarações.*

---

### `shared/src/grid.ts`
> Sem descrição de cabeçalho.

**Exports principais:**
- `fn makeGrid()`
- `fn makeFog()`
- `fn makeWalls()`
- `fn cloneGrid()`
- `fn resizeGrid()`
- `fn inBounds()`
- `fn clamp()`

---

### `shared/src/id.ts`
> Id curto e único o suficiente para uso local (na Fase 2, o servidor gera).

**Exports principais:**
- `fn uid()`

---

### `shared/src/index.ts`
> @helio/shared — regras puras do jogo. Sem React, sem canvas, sem socket. Usado pelo cliente (predição e desenho) e pelo servidor (autoridade). Uma implementação só, duas execuções. Ver docs/DECISOES.md #4.

---

### `shared/src/pathfinding.ts`
> Sem descrição de cabeçalho.

**Exports principais:**
- `fn facingBetween()`
- `fn sameCell()`
- `fn isAdjacent()`
- `fn isEdgeBlocked()`
- `fn findPath()`

---

### `shared/src/types.ts`
> Tipos do jogo. Este módulo NÃO importa React, canvas nem socket — de propósito. As mesmas regras rodam no cliente (predição/desenho) e, na Fase 2, no servidor (autoridade). Ver docs/DECISOES.md #4.

**Exports principais:**
- `type Role`
- `type Facing`
- `type Cell`
- `type FogValue`
- `type Actor`
- `type Sector`
- `type FogMode`
- `type WallDisplayMode`
- `type Tool`
- `type SceneConfig`
- *...e mais 1 declarações.*

---

### `shared/src/vision.ts`
> Sem descrição de cabeçalho.

**Exports principais:**
- `fn hasLOS()`
- `fn visibleCellsFrom()`
- `fn computeVision()`
- `fn mergeExplored()`

---

## Pacote: Server (`server/src`)

### `server/src/accounts.ts`
> Contas: criar, ler e vincular a campanha (ADR #16, #17 e #19). Tudo aqui degrada para "não existe conta" quando o banco está fora, em vez de lançar: conta é um extra, e a mesa tem que abrir de qualquer jeito.

**Exports principais:**
- `type AccountRow`
- `fn findAccountByName()`
- `type AccountPublic`
- `fn findAccountById()`
- `fn accountIsAdmin()`
- `fn touchLogin()`
- `fn createAccount()`
- `fn touchMembership()`
- `type AdminAccountRow`
- `fn listAccounts()`
- *...e mais 3 declarações.*

---

### `server/src/auth.ts`
> Senhas e sessões (ADR #16). Nada de bcrypt, nada de dependência nova: `scrypt` e `HMAC-SHA256` já vêm no `node:crypto`. São ~60 linhas que qualquer um lê. Duas decisões que valem explicação: 1. **`scrypt` assíncrono, não `scryptSync`.** Este processo também serve a partida, e Node é single-thread: um `scryptSync` de ~100 ms num login congela a mesa de todo mundo. Um login mal comportado viraria negação de serviço contra os jogadores. 2. **Sessão sem estado, só assinada.** O token carrega o que precisa e a assinatura prova que foi o servidor que emitiu. Sem tabela de sessões, reiniciar o container não desloga ninguém. O preço, que fica dito: não dá para revogar uma sessão específica — sair apaga o cookie.

**Exports principais:**
- `fn hashPassword()`
- `fn verifyPassword()`
- `const sessionEnabled`
- `type Session`
- `fn signSession()`
- `fn readSession()`
- `const SESSION_COOKIE`
- `fn cookieValue()`
- `fn sessionCookie()`
- `fn clearSessionCookie()`

---

### `server/src/db.ts`
> Conexão com o Postgres (ADR #17). Regra que vale a pena repetir: **banco fora não derruba a mesa**. Sem `DATABASE_URL`, ou com o Postgres indisponível, o servidor sobe do mesmo jeito e as salas vivem em memória, como antes. Perder a partida por causa do banco seria pior do que não ter banco. O cliente NUNCA fala com o banco — só o servidor. É essa fronteira que permite trocar esquema sem encostar em `client/` nem em `shared/`.

**Exports principais:**
- `const dbEnabled`
- `const pool`
- `fn query()`
- `fn tryQuery()`

---

### `server/src/http.ts`
> Rotas HTTP do servidor (ADR #16, #18 e #19). Duas famílias: **auth** (entrar, sair, quem sou eu, criar conta) e **campanhas** (criar, listar e apagar missões) — mais o **painel do administrador** (ADR #23), que só lista contas e troca senha. O jogo em si não passa por aqui — continua no Socket.IO. A divisão é deliberada: tempo real e CRUD em módulos separados, para trocar um sem encostar no outro. O cookie é o ponto todo: como o Socket.IO lê os cookies do handshake, a identidade chega na conexão sem inventar mensagem nova.

**Exports principais:**
- `const registrationOpen`
- `const adminAccount`
- `fn isAdminAccount()`
- `fn handleHttp()`

---

### `server/src/index.ts`
> Servidor autoritativo do HELIO (Fase 2). O cliente pede; o servidor decide. Movimento, permissão, edição de mapa e fog são validados aqui. Protocolo completo em docs/ARQUITETURA.md.

---

### `server/src/live.ts`
> Ponte entre o CRUD (HTTP) e a mesa viva (Socket.IO). Promover alguém a mestre é um ato administrativo: grava um vínculo no banco e passa pelas rotas de campanha (ADR #22). Mas o efeito é **agora** — se o papel só valesse no próximo F5, a pessoa promovida continuaria travada na frente de todo mundo sem entender por quê. A ponte existe para os dois módulos não se conhecerem: `http.ts` não importa o servidor de sockets (nem o `io`), e `index.ts` não importa rotas. Quem tem a mesa registra um ouvinte no boot; quem grava o vínculo avisa.

**Exports principais:**
- `type RoleChange`
- `fn onRoleChange()`
- `fn roleChanged()`

---

### `server/src/migrate.ts`
> Migrations em SQL numerado (ADR #17). Sem framework: lê `server/migrations/*.sql` em ordem, aplica o que ainda não rodou e registra em `schema_migrations`. Cada arquivo roda numa transação — ou aplica inteiro, ou não aplica nada. Um advisory lock evita que dois processos apliquem a mesma migration ao mesmo tempo. Arquivo aplicado não se edita. Uma correção é sempre um arquivo novo.

**Exports principais:**
- `fn migrate()`

---

### `server/src/room.ts`
> Sem descrição de cabeçalho.

**Exports principais:**
- `type ServerScene`
- `type Player`
- `type Room`
- `fn createScene()`
- `fn createRoom()`
- `type PublicState`
- `fn publicState()`

---

### `server/src/selo.ts`
> Selo da Missão — o código que o mestre dita e o grupo digita (ADR #18). O selo é o convite do convidado: quem não tem conta entra por ele, então ele precisa ser **difícil de adivinhar** e, ao mesmo tempo, **ditável em voz alta**. Código escolhido à mão erra os dois lados: "MALDICAO" é fácil de adivinhar e dois mestres escolhem o mesmo. Daí três palavras distintas mais dois dígitos: CORVO-AMBAR-VEU-74 As palavras são curtas, sem acento e sem par que soe igual na leitura (`LENTE` ficou e `LENTO` não). Sem acento porque o código é digitado do que se ouviu — e quem digitar com acento mesmo assim acerta, porque `normalizeCode` remove. A lista é validada ao carregar: palavra repetida, comprida ou fora de A-Z derruba o boot com a mensagem na cara, em vez de virar um selo esquisito que só aparece meses depois.

**Exports principais:**
- `fn normalizeCode()`
- `fn newSelo()`

---

### `server/src/store.ts`
> Persistência da cena (ADR #17). A cena viva continua em memória — rápida, como sempre foi. O banco é a cópia durável, e é escrito **com debounce**: gravar a cada evento seria amplificação de escrita por nada, porque cada mudança já transmite a cena inteira para todos os jogadores. Portanto: o banco pode estar fora, devagar ou ausente. Nenhum caminho aqui derruba a mesa — no pior caso, a partida não sobrevive a um restart.

**Exports principais:**
- `const SCENE_SCHEMA`
- `fn setDefaultGmAccount()`
- `type CampaignRef`
- `type CampaignLookup`
- `fn findCampaign()`
- `type CampaignInfo`
- `fn createCampaign()`
- `fn listCampaigns()`
- `type DeleteResult`
- `fn deleteCampaign()`
- *...e mais 9 declarações.*

---

### `server/src/validate.ts`
> Sem descrição de cabeçalho.

**Exports principais:**
- `type Verdict`
- `fn canMove()`

---

## Pacote: Client (`client/src`)

### `client/src/App.tsx`
> Sem descrição de cabeçalho.

**Exports principais:**
- `fn App()`

---

### `client/src/components/FogWarMap.tsx`
> FogWarMap.tsx — mesa de RPG com fog of war e atores que andam. UI/UX Dark Fantasy / Ocultismo (inspirado em Ordem Paranormal): - Ícones SVG vetoriais customizados em toda a interface; - Suporte completo a mobile (pinch-to-zoom, pan com 2 dedos ou ferramenta Mão, dock inferior de ferramentas, grimório lateral em drawer deslizante e D-pad opcional); - Tipografia Cinzel + Chakra Petch + JetBrains Mono. Ver docs/ARQUITETURA.md e docs/DECISOES.md.

**Exports principais:**
- `type FogWarMapProps`
- `fn FogWarMap()`

---

### `client/src/components/icons.tsx`
> Sem descrição de cabeçalho.

**Exports principais:**
- `type IconProps`
- `fn IconSigil()`
- `fn OccultMandala()`
- `fn IconMove()`
- `fn IconPan()`
- `fn IconWall()`
- `fn IconErase()`
- `fn IconReveal()`
- `fn IconHide()`
- `fn IconSector()`
- *...e mais 25 declarações.*

---

### `client/src/components/Notice.tsx`
> Sem descrição de cabeçalho.

**Exports principais:**
- `fn Notice()`

---

### `client/src/components/PlayersPanel.tsx`
> Sem descrição de cabeçalho.

**Exports principais:**
- `fn PlayersPanel()`

---

### `client/src/main.tsx`
> Sem descrição de cabeçalho.

---

### `client/src/net/auth.ts`
> A API do servidor — contas e missões (docs/DECISOES.md #16, #18 e #19). Tudo vive sob `/api` (o Caddy manda o prefixo inteiro para o app), e as duas famílias são: /api/auth/*       entrar, sair e "quem sou eu" (ADR #16) /api/accounts     criar conta (ADR #19) /api/campaigns    criar, listar e apagar missões (ADR #18) /api/campaigns/:selo/role   dar/tirar o papel de mestre (ADR #22) /api/admin/*      listar contas e trocar senha (ADR #23) O cookie de sessão vai e volta sozinho (mesma origem), e é ele que o Socket.IO lê no handshake — depois do login, o `connect()` não precisa saber de nada disso. A senha NUNCA é guardada aqui: nem em estado, nem em localStorage. Só existe durante a requisição. O que fica no navegador é o cookie `HttpOnly`, que o JavaScript não enxerga de propósito.

**Exports principais:**
- `type Account`
- `type Campaign`
- `type AuthResult`
- `type CampaignsResult`
- `type SessionInfo`
- `fn loadSession()`
- `fn login()`
- `fn createAccount()`
- `fn logout()`
- `fn listCampaigns()`
- *...e mais 8 declarações.*

---

### `client/src/net/bridge.ts`
> Ponte entre o store do jogo e a rede. Existe para evitar dependência circular: o store importa daqui (só estas funções), e `net/socket.ts` é quem instala o transmissor de verdade quando conecta. Sem conexão, `isOnline()` é falso e o store funciona sozinho (modo local, como nas Fases 0/1).

**Exports principais:**
- `type Sender`
- `fn setSender()`
- `fn isOnline()`
- `fn send()`

---

### `client/src/net/socket.ts`
> Adapter de rede — Socket.IO (docs/DECISOES.md #2). Responsabilidades: - conectar e entrar na sala; - aplicar o estado autoritativo do servidor no gameStore; - transmitir intenções (o store chama via `net/bridge.ts`); - desfazer a predição local quando o servidor recusa um movimento. Trocar de transporte (Colyseus, WebRTC) significa reescrever só este arquivo.

**Exports principais:**
- `type ServerState`
- `type JoinOptions`
- `fn connect()`
- `fn disconnect()`

---

### `client/src/render/animation.ts`
> Sem descrição de cabeçalho.

**Exports principais:**
- `type Anim`
- `type AnimMap`
- `fn stepAnimations()`

---

### `client/src/render/assets.ts`
> Manifestos de arte gerados por `tools/optimize-assets.ps1`. Os originais ficam em `img/` (fora do git). O script gera miniaturas em `client/public/tokens/` e `client/public/maps/`, mais um `manifest.json` em cada pasta. Aqui só carregamos esses manifestos em memória.

**Exports principais:**
- `type AssetEntry`
- `type MapEntry`
- `type AssetManifests`
- `fn loadAssets()`

---

### `client/src/render/images.ts`
> Cache de imagens (tokens, fundos de mapa). Evita recriar `new Image()` a cada frame e permite desenhar assim que carrega.

**Exports principais:**
- `fn getImage()`

---

### `client/src/render/sprites.ts`
> Sem descrição de cabeçalho.

**Exports principais:**
- `type SpriteSheet`
- `fn getSheet()`
- `type ActorDraw`
- `fn drawActor()`

---

### `client/src/screens/Admin.tsx`
> Sem descrição de cabeçalho.

**Exports principais:**
- `fn Admin()`

---

### `client/src/screens/Entrar.tsx`
> Sem descrição de cabeçalho.

**Exports principais:**
- `fn Entrar()`

---

### `client/src/screens/Mesa.tsx`
> Sem descrição de cabeçalho.

**Exports principais:**
- `fn Mesa()`

---

### `client/src/screens/Shell.tsx`
> Sem descrição de cabeçalho.

**Exports principais:**
- `fn Shell()`

---

### `client/src/state/gameStore.ts`
> Sem descrição de cabeçalho.

**Exports principais:**
- `type ServerScene`
- `type GameState`
- `const useGameStore`

---

### `client/src/state/netStore.ts`
> Sem descrição de cabeçalho.

**Exports principais:**
- `type NetPlayer`
- `type NetStatus`
- `type NetState`
- `const useNetStore`
- `const isGm`
- `fn flashNotice()`

---

### `client/src/state/sessionStore.ts`
> Sem descrição de cabeçalho.

**Exports principais:**
- `type SessionState`
- `const useSession`

---

