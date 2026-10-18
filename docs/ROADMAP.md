# Roadmap

Cada fase termina em algo **utilizável e demonstrável**. Nada de "metade de tudo".

Legenda: ✅ feito · 🔜 próximo · ⬜ pendente

---

## Fase 0 — Estrutura e estado ✅

Tirar o estado de dentro do React, separar lógica de jogo, montar o projeto.

- ✅ Projeto Vite + React + TypeScript em `client/`
- ✅ `game/` puro: tipos, constantes, grade, visão (LOS), pathfinding (BFS)
- ✅ `state/gameStore.ts` (Zustand) com o estado de jogo
- ✅ Estado de UI (ferramenta, pan, zoom, modais) permanece no componente
- ✅ `FogWarMap` portado, com todos os recursos do protótipo funcionando
- ✅ `README.md` + documentação (`ARQUITETURA`, `DEPLOY`, `DECISOES`, `ROADMAP`)

**Pronto quando:** o mapa roda igual ao protótipo, sem nada preso em `useState` de jogo.

---

## Fase 1 — Sprites andando (local) ✅

O pedido original: sprites que andam pelo mapa.

- ✅ `Actor` com `facing`, `sprite`, `vision`, `ownerId`, `canMove`
- ✅ Pathfinding BFS ortogonal respeitando paredes
- ✅ Fila de células: ator segue o caminho célula a célula
- ✅ Interpolação: posição renderizada (float) persegue a lógica (inteira) a velocidade constante
- ✅ Animação de caminhada (`walkFrame`) que volta ao repouso ao chegar
- ✅ `render/sprites.ts`: desenhador procedural + suporte a PNG por chave
- ✅ Clique no mapa move o ator ativo até a célula (andando, não teleportando)
- ✅ Grid (toggles) movido para fora do React, evita re-render desnecessário

**Pronto quando:** clicar longe faz o sprite caminhar até lá desviando de paredes, com animação.

**Próximo passo opcional desta fase:** colocar arte real em `client/public/sprites/`.

---

## Fase 2 — Multiplayer 🔜

Servidor autoritativo com salas. Ver e mover tokens em conjunto.

- ⬜ `server/` Node + Socket.IO
- ⬜ Salas com código (`HELIO-XXXX`), `room:join` / `room:leave`
- ⬜ Estado da cena no servidor (formato de `ARQUITETURA.md`)
- ⬜ Reconciliação: snapshot (`room:state`) + patch (`room:patch`) com `version`
- ⬜ Adapter `client/src/net/socketIo.ts` implementando `NetAdapter`
- ⬜ `actor:intent-move` validado no servidor (até 1 casa, ortogonal, sem parede)
- ⬜ Presença: lista de jogadores conectados
- ⬜ Comprimir walls/fog na rede (bitset + RLE)

**Pronto quando:** duas abas do browser entram na mesma sala e veem o token da outra andando.

---

## Fase 3 — Papéis, permissão e fog por jogador 🔜

O mestre manda; o jogador obedece.

- ⬜ `role: "gm" | "player"` e `ownerId` nos atores
- ⬜ GM: libera movimento global (`canMoveGlobal`) ou por token (`canMove`)
- ⬜ Validação de permissão no servidor + `error` legível pro cliente
- ⬜ UI do GM: painel de jogadores com botões de liberar
- ⬜ Cliente do jogador não muda `row/col` sem confirmação do servidor
- ⬜ Tratar movimento **rejeitado** (corrigir a fila, voltar o sprite)
- ⬜ Fog dividido: `fogExplored` (sala) + `visibleNow` (por jogador)
- ⬜ `fog:discover` enviando células novas ao servidor
- ⬜ GM vê tudo; jogador vê só o token dele

**Pronto quando:** o jogador só anda quando o GM libera, e o fog de cada um é individual.

**Endurecimento opcional:** servidor passa a calcular `visibleNow` (anti-cheat) e só envia o
resultado.

---

## Fase 4 — Polimento ⬜

- ⬜ Voz (WebRTC) — Socket.IO já é a sinalização
- ⬜ Rolagem de dados com histórico
- ⬜ Fichas de personagem (Ordem Paranormal customizado)
- ⬜ Chat e log de eventos
- ⬜ Biblioteca de mapas e tokens (upload pelo GM)
- ⬜ Deploy "sem Docker": Node SEA + Caddy `.exe` num PS1 (ver `DEPLOY.md`)
- ⬜ Reconexão robusta e reentrada pelo mesmo `actorId`
- ⬜ Testes automatizados de `game/` (colisão, LOS, pathfinding, validação)

---

## Fase 5 — Ideias (não compromisso)

- Efeitos (fogo, névoa mágica, iluminação colorida)
- Condições/status nos tokens, barras de vida
- Macro de combate e iniciativa
- Múltiplos mapas por campanha com transição
- Diário da campanha e handouts
