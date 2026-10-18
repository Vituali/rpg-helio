# HELIO — VTT multiplayer para RPG de mesa

Mesa virtual (VTT — *Virtual Tabletop*) para RPG de mesa — baseada em **Ordem Paranormal**, mas com
sistema personalizado. O mestre vê tudo e controla o mapa; os jogadores veem apenas o que o token
deles enxerga.

## Escopo

Isto é um **VTT**, não um RPG eletrônico.

O computador **não joga**: ele apresenta o mapa e as ferramentas. Quem narra é o mestre; quem decide
é o grupo. O que o software faz:

- mapa com grade e **fog of war**, com visão calculada por jogador;
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
- `Maze.jpg` — mapa de exemplo.

## Estado atual

Já portado para o projeto de verdade em `client/`:

- Estrutura Vite + React + TypeScript.
- Lógica de jogo isolada e testável em `client/src/game/` (grade, visão, pathfinding).
- Estado do jogo centralizado em `client/src/state/gameStore.ts` (Zustand) — pronto para virar
  estado vindo do servidor na Fase 2.
- **Atores que andam pelo mapa**, com pathfinding (BFS), interpolação de posição e dois modos de
  desenho: **token** (retrato estático que desliza) e **sprite** (caminhada com 4 direções).
- Pipeline de arte: `tools/optimize-assets.ps1` gera os tokens e mapas da web a partir de `img/`.

## Arte

Os originais em `img/` são enormes (tokens 3000×3400, mapa 36 MB) e ficam **fora do git**. O script
`tools/optimize-assets.ps1` gera as versões da web e os manifestos:

```powershell
powershell -ExecutionPolicy Bypass -File tools\optimize-assets.ps1
```

| De | Para | Resultado |
|---|---|---|
| `img/tokens/*.png` | `client/public/tokens/*.png` | 59 tokens 256×256, **2 MB** (era 230 MB) |
| `img/maps/*` | `client/public/maps/*.jpg` | 1 mapa 2400px, **2 MB** |

Rode de novo sempre que adicionar arte. O app lê `manifest.json` de cada pasta para popular os
seletores de token e de mapa no painel lateral.

Ainda **não** existe o servidor multiplayer nem o deploy — isso é Fase 2 e Fase 3 (ver `docs/ROADMAP.md`).

## Rodando o cliente

```bash
cd client
npm install
npm run dev
```

Abre em `http://localhost:5173`.

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) | Como o jogo é montado: camadas, estado, rede, visão, permissões |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Firebase vs self-hosted, Docker Compose, Caddy, CGNAT, Tailscale, o PS1 |
| [`docs/DECISOES.md`](docs/DECISOES.md) | Registro de decisões (ADRs) e o porquê de cada uma |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Fases 0 a 4, com critérios de pronto |

## Estrutura

```
HELIO/
├── client/                  # front (Vite + React + TS)
│   ├── public/
│   │   ├── tokens/          # tokens otimizados + manifest.json
│   │   ├── maps/            # mapas otimizados + manifest.json
│   │   └── sprites/         # spritesheets de caminhada (opcional)
│   └── src/
│       ├── game/            # lógica pura, sem React e sem rede
│       ├── state/           # store do jogo (fonte da verdade no cliente)
│       ├── render/          # desenho no canvas (atores, sprites, imagens)
│       ├── net/             # cliente de rede (Fase 2)
│       └── components/      # UI React
├── server/                  # servidor autoritativo Socket.IO (Fase 2)
├── deploy/                  # docker-compose, Dockerfile, Caddyfile, install.ps1
├── tools/                   # optimize-assets.ps1 (arte → web)
├── docs/                    # documentação
├── img/                     # arte original (fora do git, ~230 MB)
├── RPG GRID/FogWarMap.jsx   # protótipo original (referência)
└── Maze.jpg
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
