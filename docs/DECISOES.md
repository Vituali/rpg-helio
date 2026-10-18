# Decisões (ADRs)

Formato curto: contexto → decisão → consequências. Ordem cronológica.

---

## #1 — Transporte: Socket.IO, não Colyseus

**Contexto.** Precisa sincronizar estado em tempo real. Colyseus é feito para jogos (salas, schema
com delta binário automático, reconexão, matchmaking). Socket.IO é genérico.

**Fatos que decidiram.**
- Escala real: 30×22 = 660 células. Fog como `Uint8` = 660 B; paredes como bitset = 83 B; tokens
  ~50 B cada. **Snapshot completo < 1 KB.** Com 8 jogadores a 5 mudanças/s, ~40 KB/s saindo do
  servidor. É nada.
- O valor do Colyseus (delta binário) só compensa com estado grande demais para mandar inteiro.
- O time já conhece Socket.IO (usou com WebRTC/FreeSWITCH) → menor curva, melhor manutenção.
- Socket.IO serve também como **canal de sinalização WebRTC** quando virar voz.
- Frames em JSON são legíveis no DevTools do browser.

**Decisão.** Socket.IO, com a lógica de jogo isolada em `game/` e a rede atrás de uma interface
`NetAdapter`.

**Consequências.** Implementamos reconciliação/reconexão na mão (trivial nesta escala). Analogia
com Colyseus fica documentada como plano B — se o estado crescer (muitos mapas, muitas entidades),
troca-se só a implementação de `NetAdapter`, o jogo não muda.

---

## #2 — Hospedagem: self-hosted (Docker), não Firebase

**Contexto.** Firebase é gratuito e não exige rede. Mas o estado do jogo é um grid grande e
mutável com lógica autoritativa.

**Fatos que decidiram.**
- Firestore: um documento com o grid estoura fácil ou vira centenas de escritas; quotas machucam
  justamente durante a partida.
- Realtime Database não dá autoridade: ou o cliente escreve direto (dá pra forjar posição), ou
  passa por Cloud Functions (latência + limites).
- O caso é **um estado pequeno, único e autoritativo** a poucos eventos/s → caso clássico de
  servidor com WebSocket.
- Self-hosted: sem quota, controle total, funciona em LAN, casa com o "cliente roda um PS1".

**Decisão.** Docker Compose (app Node + Caddy). Firebase fica descartado para gameplay.

**Consequências.** Herdamos o problema de rede (HTTPS em IP, CGNAT, IP dinâmico) → resolvido em
`DEPLOY.md` (DuckDNS + Caddy, Tailscale como escape do CGNAT). Tocamos a infra, o que também é
uma vantagem: dá pra jogar offline na LAN.

---

## #3 — Estado do jogo: store único (Zustand), fora do React

**Contexto.** No protótipo, `fog`, `walls` e `tokens` vivem em `useState` dentro de `FogWarMap`.
Ninguém fora do componente vê esse estado — impossível sincronizar.

**Decisão.** Zustand como store do lado cliente. Estado de jogo (grade, atores, setores, config)
sai do componente; estado de UI (ferramenta ativa, pan, zoom, modais) continua local.

**Consequências.** O estado pode ser serializado (snapshot), desacoplado da árvore React e
trocado por patch do servidor sem redesenhar a UI. Zustand por ser minimalista e sem boilerplate.
Alternativa descartada: Context + useReducer (re-renderiza demais com grid grande).

---

## #4 — Lógica de jogo pura e compartilhada

**Contexto.** Regras (colisão, LOS, pathfinding, validação de movimento) precisam rodar no cliente
(predição/desenho) **e** no servidor (autoridade).

**Decisão.** `game/` é função pura, sem React, sem canvas, sem socket. O servidor importa o mesmo
módulo.

**Consequências.** Zero divergência de regra entre cliente e servidor (o bug clássico de VTT).
Testável sem browser. Custo: disciplina para não vazar dependência de UI pra dentro de `game/`.

---

## #5 — Movimento: intenção + predição + interpolação

**Contexto.** Manda verdade ("estou em 5,7") ou intenção ("quero ir pra 5,7")? E como evitar o
teleporte quando o pacote chega?

**Decisão.** Cliente manda **intenção**; servidor valida e confirma. O ator tem **duas posições**:
lógica (autoritativa, inteira) e renderizada (local, float), aproximadas a cada frame. Pathfinding
BFS alimenta uma fila de células; cada célula alcançada avança a posição lógica e (Fase 2) dispara
um `intent-move`.

**Consequências.** Sprite anda suavemente mesmo com latência; mapa não é forjável. Custo: o cliente
precisa lidar com movimento rejeitado pelo servidor (corrigir a fila) — previsto na Fase 3.

---

## #6 — Fog dividido: explorado (sala) vs. visível (jogador)

**Contexto.** O protótipo calcula a visão com **todos** os tokens, o que vaza a visão alheia.

**Decisão.** `fogExplored` é do servidor (permanente, compartilhado). `visibleNow` é calculado por
jogador, só com o token dele. Fase 3 começa com visão calculada no cliente (confiança no grupo) e
o servidor mesclando as células descobertas; anti-cheat (servidor calcula) fica como opção.

**Consequências.** Cada jogador vê o que deveria. Custo de CPU no raycast é irrelevante nesta
escala. Anti-cheat é um passo incremental, não uma reescrita.

---

## #7 — Sprites: PNG opcional com fallback procedural

**Contexto.** O protótipo desenha tokens como círculos. Precisamos de "sprites andando", mas não
há arte ainda e o projeto precisa rodar hoje.

**Decisão.** `render/sprites.ts` carrega `/sprites/<key>.png` (4 linhas: S, W, E, N × N colunas de
frames). Se o arquivo não existir, usa um **desenhador procedural** (corpo + pernas que alternam
por frame). `facing` e `walkFrame` são iguais nos dois modos.

**Consequências.** Zero asset necessário para rodar; soltar o PNG é o único passo para trocar por
arte real. O código de animação não muda.
