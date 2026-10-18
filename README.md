# HELIO — VTT multiplayer para RPG de mesa

Mesa virtual (VTT — *Virtual Tabletop*) para RPG de mesa — baseada em **Ordem Paranormal**, mas com
sistema personalizado. O mestre vê tudo e controla o mapa; os jogadores veem apenas o que o token
deles enxerga.

## Escopo

Isto é um **VTT**, não um RPG eletrônico.

O computador **não joga**: ele apresenta o mapa e as ferramentas. Quem narra é o mestre; quem decide
é o grupo. O que o software faz:

- mapa com grade e **fog of war** (explorado compartilhado; visão por jogador chega na Fase 3);
- **tokens** que o mestre e os jogadores movem pelo mapa;
- **permissão**: o mestre libera quem pode andar;
- ferramentas de apoio: paredes, setores nomeados, medição, dados, fichas, handouts.

O que **não** é, e não pretende ser:

- engine de combate, IA de inimigos, balanceamento ou progressão automática;
- batalha por turnos conduzida pelo próprio jogo.

Se algo assim aparecer, é acessório digitado pelo mestre na mesa — nunca o motor da coisa.

## O que já existe

- `RPG GRID/FogWarMap.jsx` — protótipo original (single-player) com fog of war, LOS, paredes,
  setores, minimap, pan/zoom e export/import. **É a referência direta do mapa**, mantido intacto.
- `img/` — arte do jogo (tokens, artes de personagem, mapas) em altíssima resolução, **~230 MB**.
  Fica **fora do git** (ver `.gitignore`); as versões otimizadas para web irão em `client/public/`.
- `arquivos temporarios/Primeiro RPG que fiz para ele/` — projeto anterior em **React + Firebase**
  (fichas, inventário, habilidades, rituais, painel do mestre, rolador de dados, status ao vivo via
  Realtime Database). Repositório git próprio; serve de **referência** para portar essas telas.
- `img/maps/` — mapas em alta resolução (`Maze.jpg` 36 MB, `D'Base.jpg` 10 MB), **fora do git**.

## Estado atual

Portado para o projeto de verdade:

- Estrutura Vite + React + TypeScript em `client/`.
- Lógica de jogo isolada e testável em `shared/` (grade, visão, pathfinding) — usada pelo cliente
  **e** pelo servidor.
- Estado do jogo centralizado em `client/src/state/gameStore.ts` (Zustand), alimentado pelo servidor.
- **Atores que andam pelo mapa**, com pathfinding (BFS), interpolação de posição e dois modos de
  desenho: **token** (retrato estático que desliza) e **sprite** (caminhada com 4 direções).
- Pipeline de arte: `tools/optimize-assets.ps1` gera os tokens e mapas da web a partir de `img/`.
- **Multiplayer**: servidor autoritativo em `server/` (Node + Socket.IO), salas por código, papéis
  (mestre/jogador), permissão de movimento liberada pelo mestre, fog explorado compartilhado.

O que ainda falta está em [`docs/ROADMAP.md`](docs/ROADMAP.md) — o próximo item é o fog por jogador
(Fase 3).

## Arte

Os originais em `img/` são enormes (tokens 3000×3400, mapa 36 MB) e ficam **fora do git**. O script
`tools/optimize-assets.ps1` gera as versões da web e os manifestos:

```powershell
powershell -ExecutionPolicy Bypass -File tools\optimize-assets.ps1
```

| De | Para | Resultado |
|---|---|---|
| `img/tokens/*.png` | `client/public/tokens/*.png` | 59 tokens 256×256, **2 MB** (era 230 MB) |
| `img/maps/*` | `client/public/maps/*.jpg` | 2 mapas 2400px, **2,8 MB** |

Rode de novo sempre que adicionar arte. O app lê `manifest.json` de cada pasta para popular os
seletores de token e de mapa no painel lateral. O manifesto do mapa guarda também a **largura e a
altura** da imagem: com isso o botão `⊞` ao lado do mapa ajusta a grade ao formato dele — sem isso
a imagem aparece esticada.

O servidor multiplayer já existe (Fase 2 ✅) — o próximo passo é a visão por jogador (Fase 3).

## Rodando

### Só o cliente (modo local)

Serve para o mestre preparar o mapa sozinho, sem servidor. Na tela de entrada, escolha
**"Preparar o mapa sozinho"**.

```bash
cd client
npm install
npm run dev
```

Abre em `http://localhost:5173`.

### Juntos (cliente + servidor)

Dois terminais:

```bash
# terminal 1 — servidor de jogo
cd server
npm install
npm run dev          # http://localhost:3000
```

```bash
# terminal 2 — cliente
cd client
npm run dev          # http://localhost:5173
```

O cliente em dev manda `/socket.io` para `localhost:3000` pelo proxy do Vite — é o mesmo caminho
que o Caddy usa em produção, então não há surpresa ao subir.

**Como entrar:** todos abrem a mesma página, combinam um **código de sala** (ex.: `HELIO`) e entram.
Quem abre a sala primeiro vira o **mestre**; os outros escolhem *Jogador* e recebem um token próprio.
O mestre libera o movimento pelo painel 👥 MESA, no painel lateral.

Teste rápido das regras do servidor (sobe o servidor antes):

```bash
cd server
npm run smoke        # 12 verificações: permissão, parede, fog, saída
```

### Em produção (Docker)

Ver [`docs/DEPLOY.md`](docs/DEPLOY.md). Resumo:

```bash
cd deploy
copy .env.example .env     # só na primeira vez
docker compose up -d --build
```

O Caddy serve o front e faz o proxy do WebSocket; só 80/443 saem para fora. O endereço público é
**uma variável só**, `SITE_ADDRESS`, no `deploy/.env`: o padrão `:80` já funciona em
`http://localhost` **e** na rede local (`http://192.168.1.69`); troque por um domínio
(`helio.duckdns.org`, `189-40-12-7.sslip.io`) para ter HTTPS automático.

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) | Como o jogo é montado: camadas, estado, rede, visão, permissões |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Firebase vs self-hosted, Docker Compose, Caddy, CGNAT, Tailscale, o PS1 |
| [`docs/DECISOES.md`](docs/DECISOES.md) | Registro de decisões (ADRs) e o porquê de cada uma |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Fases 0 a 5, com critérios de pronto |

## Estrutura

```
HELIO/
├── shared/                  # lógica pura (grade, visão, pathfinding) — cliente E servidor
│   └── src/
├── client/                  # front (Vite + React + TS)
│   ├── public/
│   │   ├── tokens/          # tokens otimizados + manifest.json
│   │   ├── maps/            # mapas otimizados + manifest.json
│   │   └── sprites/         # spritesheets de caminhada (opcional)
│   └── src/
│       ├── state/           # stores: jogo (gameStore) e conexão (netStore)
│       ├── net/             # adapter Socket.IO (bridge.ts + socket.ts)
│       ├── render/          # desenho no canvas (atores, sprites, imagens)
│       └── components/      # UI React (FogWarMap, Lobby, PlayersPanel)
├── server/                  # servidor autoritativo Socket.IO
│   ├── src/                 # index.ts (socket), room.ts (estado), validate.ts (regras)
│   ├── scripts/smoke.mjs    # teste de fumaça com dois clientes
│   └── Dockerfile
├── deploy/                  # docker-compose, Dockerfile, Caddyfile, install.ps1, .env
├── tools/                   # optimize-assets.ps1 (arte → web)
├── docs/                    # documentação
├── img/                     # arte original (fora do git, ~230 MB)
│   ├── maps/                # mapas em alta resolução (originais)
│   └── tokens/              # retratos em alta resolução (originais)
└── RPG GRID/FogWarMap.jsx   # protótipo original (referência)
```

## Controles do mapa (cliente)

| Tecla | Ação |
|---|---|
| `M` / `W` / `E` | Ferramenta mover / parede / apagar |
| `R` / `H` | Revelar / esconder fog |
| `S` | Novo setor |
| `G` | Alternar modo GM |
| `F` | Fog suave / dura |
| `0` | Enquadrar mapa |
| `←↑↓→` | Mover ator ativo (1 casa) |
| Clique | Mover ator ativo até a célula (com pathfinding) |
| Clique direito / Alt+clique | Pan |
| Scroll | Zoom |
