# HELIO — VTT multiplayer para RPG

Mesa virtual (virtual tabletop) para mestrar RPG — baseada em **Ordem Paranormal**, mas com sistema
personalizado. O mestre vê tudo e controla o mapa; os jogadores veem apenas o que o token deles enxerga.

## O que já existe

- `RPG GRID/FogWarMap.jsx` — protótipo original (single-player) com fog of war, LOS, paredes,
  setores, minimap, pan/zoom e export/import. **É a referência do projeto**, mantido intacto.
- `Maze.jpg` — mapa de exemplo.

## Estado atual

Já portado para o projeto de verdade em `client/`:

- Estrutura Vite + React + TypeScript.
- Lógica de jogo isolada e testável em `client/src/game/` (grade, visão, pathfinding).
- Estado do jogo centralizado em `client/src/state/gameStore.ts` (Zustand) — pronto para virar
  estado vindo do servidor na Fase 2.
- **Ator com sprite que anda pelo mapa**, com pathfinding (BFS), animação de caminhada e
  interpolação de posição.

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
│   └── src/
│       ├── game/            # lógica pura, sem React e sem rede
│       ├── state/           # store do jogo (fonte da verdade no cliente)
│       ├── render/          # desenho no canvas (atores, sprites)
│       ├── net/             # cliente de rede (Fase 2)
│       └── components/      # UI React
├── server/                  # servidor autoritativo Socket.IO (Fase 2)
├── deploy/                  # docker-compose, Caddyfile, install.ps1
├── docs/                    # documentação
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
