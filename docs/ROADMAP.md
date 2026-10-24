# Roadmap

Cada fase termina em algo **utilizável e demonstrável**. Nada de "metade de tudo".

Legenda: ✅ feito · 🔜 próximo · ⬜ pendente

---

## Fase 0 — Estrutura e estado ✅

Tirar o estado de dentro do React, separar lógica de jogo, montar o projeto.

- ✅ Projeto Vite + React + TypeScript em `client/`
- ✅ `game/` puro: tipos, constantes, grade, visão (LOS), pathfinding (BFS) — hoje vive em `shared/`
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

## Fase 2 — Multiplayer ✅

Servidor autoritativo com salas. Ver e mover tokens em conjunto.

- ✅ `shared/` com as regras puras, usado pelo cliente **e** pelo servidor (uma implementação só)
- ✅ `server/` Node + Socket.IO (`server/src/index.ts`, `room.ts`, `validate.ts`)
- ✅ Salas com código; jogador que entra ganha um token próprio; **mestre entra com senha** (`GM_KEY`)
- ✅ Estado da cena no servidor (formato de `ARQUITETURA.md`) com `version`
- ✅ `room:state` — snapshot completo a cada mudança (+ ack no `room:join`)
- ✅ Adapter em `client/src/net/` (`bridge.ts` + `socket.ts`)
- ✅ `actor:intent-move` validado no servidor (1 casa, ortogonal, sem parede, dentro do grid)
- ✅ Predição local + correção: passo negado cancela o caminho e volta o token
- ✅ Presença: lista de jogadores e painel da mesa no sidebar
- ✅ Entrada em **páginas** (`/entrar`, `/mesa`, `/`, `/local`) + modo local sem servidor — ADR #21
- ✅ `fogExplored` compartilhado e `fog:discover`
- ✅ Teste de fumaça (`server/scripts/smoke.mjs`, 21 verificações) passando local, via proxy do
  Vite e contra o container de produção
- ✅ `deploy/`: serviço `app` + proxy `/socket.io` no Caddy; imagens buildam e sobem
- ⬜ Comprimir walls/fog na rede (bitset + RLE) — **só se incomodar na prática**

**Pronto quando:** duas abas do browser entram na mesma sala e veem o token da outra andando. ✅

---

## Fase 2.5 — A sessão que sobrevive ✅ (entregas 1–6)

Não estava no roadmap: nasceu de um pedido concreto ("não quero redigitar tudo toda sessão") e virou a
metade do projeto que o site vai herdar. **A conta é a mesma na mesa e no site.**

- ✅ **Persistência** (ADR #17): Postgres, migrations em SQL numerado, cena em JSONB, escrita com
  debounce — e o banco fora **nunca** derruba uma mesa aberta.
- ✅ **Conta e sessão** (ADRs #16 e #19): `scrypt`, cookie `HttpOnly` assinado (stateless), cadastro
  aberto com teto e interruptor.
- ✅ **Selo da Missão** (ADR #18): `CORVO-AMBAR-VEU-74`, gerado, ditável, e selo desconhecido não entra.
- ✅ **Papel pelo vínculo** (ADR #19): quem criou é mestre e dono; entrar grava vínculo de agente.
- ✅ **Conta obrigatória** (ADR #20): sem sessão não se entra; o cliente não pede mais nome nem papel;
  `GM_KEY` vazia = nenhuma escapatória.
- ✅ **Páginas** (ADR #21): `/entrar`, `/mesa`, `/` e `/local`, cada uma com uma pergunta.
- ✅ **Promoção a mestre** (ADR #22): o mestre outorga o papel pelo painel, **na hora**, sem F5.

**Pronto quando:** cair, dar F5, trocar de aparelho ou voltar no dia seguinte não te transforma em outra
pessoa. ✅

---

## Fase 3 — Papéis, permissão e fog por jogador 🔜

O mestre manda; o jogador obedece. **Metade disto já saiu junto com a Fase 2** — a lista abaixo
separa o que existe do que falta.

Já feito:

- ✅ `role: "gm" | "player"` e `ownerId` nos atores
- ✅ GM libera movimento global (`canMoveGlobal`) e por token (`canMove`)
- ✅ Validação de permissão no servidor + `error` legível pro cliente
- ✅ UI do GM: painel de jogadores com botões de liberar/travar (individual e em massa)
- ✅ Movimento rejeitado tratado (cancela a fila, volta o sprite para a posição confirmada)
- ✅ `fog:discover` enviando células novas ao servidor

Falta:

- 🔜 Fog dividido: `visibleNow` por jogador, sem vazar a visão dos outros tokens
- 🔜 GM vê tudo; jogador vê só o token dele
- 🔜 Vincular um jogador a um token que já existe (hoje o token nasce com ele)
- 🔜 Arrastar token do mestre para o jogador (hoje é automático)
- 🔜 Ficha de personagem ligada ao token

**Pronto quando:** o fog de cada um é individual.

**Endurecimento opcional:** servidor passa a calcular `visibleNow` (anti-cheat) e só envia o
resultado.

---

## Fase 4 — Polimento ⬜

- 🟡 **RBAC de verdade**: contas, sessão assinada, papel de mestre pelo **vínculo** com a missão
  (ADRs #16 e #19) e a **outorga do papel pelo próprio mestre** (ADR #22) já existem; falta a permissão
  por token e o `GM_KEY` sair — o que depende de recuperação de senha e revogação de sessão. É o passo
  para virar projeto e não só mesa de amigos; planejado para escalar.
- ⬜ Voz (WebRTC) — Socket.IO já é a sinalização
- ⬜ Rolagem de dados com histórico
- ⬜ Fichas de personagem (Ordem Paranormal customizado)
- ⬜ Chat e log de eventos
- ⬜ Biblioteca de mapas e tokens (upload pelo GM)
- ⬜ Deploy "sem Docker": Node SEA + Caddy `.exe` num PS1 (ver `DEPLOY.md`)
- ⬜ Reconexão robusta e reentrada pelo mesmo `actorId`
- ⬜ Testes automatizados de `shared/` (colisão, LOS, pathfinding, validação)

---

## Fase 5 — Ideias (não compromisso)

- Efeitos (fogo, névoa mágica, iluminação colorida)
- Condições/status nos tokens, barras de vida
- Macro de combate e iniciativa
- Múltiplos mapas por campanha com transição
- Diário da campanha e handouts
