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

**Decisão.** Socket.IO, com a lógica de jogo isolada em `shared/` e a rede atrás de um adapter
(`client/src/net/`).

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

**Decisão.** `shared/` é função pura, sem React, sem canvas, sem socket. Cliente e servidor importam
o mesmo pacote (`@helio/shared`), cada um pela sua resolução (alias do Vite / `paths` do tsconfig).

**Consequências.** Zero divergência de regra entre cliente e servidor (o bug clássico de VTT).
Testável sem browser. Custo: disciplina para não vazar dependência de UI pra dentro de `shared/` —
e um detalhe que já mordeu: o `shared/package.json` precisa de `"type": "module"`, senão o `tsx`
carrega os arquivos como CommonJS e os `export *` somem em runtime (o cliente continua funcionando,
o servidor quebra). Ver `ARQUITETURA.md`.

---

## #5 — Movimento: intenção + predição + interpolação

**Contexto.** Manda verdade ("estou em 5,7") ou intenção ("quero ir pra 5,7")? E como evitar o
teleporte quando o pacote chega?

**Decisão.** Cliente manda **intenção**; servidor valida e confirma. O ator tem **duas posições**:
lógica (autoritativa, inteira) e renderizada (local, float), aproximadas a cada frame. Pathfinding
BFS alimenta uma fila de células; cada célula alcançada avança a posição lógica e dispara um
`intent-move`. O cliente anda antes de pedir licença (predição) e o servidor corrige quando nega.

**Consequências.** Sprite anda suavemente mesmo com latência; mapa não é forjável. O cliente lida
com movimento rejeitado: guarda a última posição confirmada e cancela a fila quando o servidor
recusa. Duas armadilhas resolvidas no caminho: (a) `path` é só do cliente — ao aplicar o snapshot,
o `path` local é preservado, senão o token pararia a cada pacote; (b) a validação do servidor exige
passos de 1 casa, o que dispensa refazer pathfinding no servidor.

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
arte real. O código de animação não muda. Quando a arte do grupo é **retrato** (é o caso), o modo
token (`Actor.portrait`) desenha um retrato recortado em círculo que desliza — o que combina com o
material que já existe em `img/tokens/`.

---

## #8 — `shared/` como pacote real, servidor rodando TypeScript direto

**Contexto.** O ADR #4 dizia "uma implementação só". Cumprir isso exigia decidir *onde* o código
compartilhado mora e como os dois lados o resolvem.

**Decisão.** `shared/` é um pacote (`@helio/shared`) com os fontes em TypeScript, resolvido pelo
alias do Vite + `paths` do tsconfig no cliente, e por `paths` + `tsx` no servidor. O servidor não
tem passo de compilação: `tsx` executa `.ts` direto (está em `dependencies`, não em dev).

**Alternativas descartadas.**
- **npm workspaces**: mais cerimônia (raiz com `package.json`, hoisting de `node_modules`) e o
  ganho seria só não repetir dois `paths`. Não pagava.
- **Duplicar as ~15 linhas de validação no servidor**: seria rápido hoje e é exatamente o bug que o
  ADR #4 existe para evitar. Duas cópias de uma regra divergem em silêncio.
- **Compilar `shared/` para `.js` antes de subir**: mais um passo de build para produção, com
  risco de servir artefato velho.

**Consequências.** Uma regra, um arquivo, dois processos. O `tsx` em produção custa um transpile
em memória (~1 s no boot) — irrelevante. E ficou registrado o tropeço do `"type": "module"`.

---

## #9 — Rede: snapshot completo, não delta

**Contexto.** O ARQUITETURA previa `room:patch` com deltas sobre `version`. Na prática o snapshot
inteiro da cena cabe em poucos KB.

**Decisão.** Servidor manda `room:state` completo a cada mudança autoritativa. Nada de delta nesta
fase. Sem compressão de walls/fog — JSON puro.

**Consequências.** Muito menos código, nenhum estado divergente possível, e depuração trivial (todo
pacote é o mundo inteiro). Numa mesa de 4–6 pessoas a uma ação por segundo, é ruído de rede. Se um
dia incomodar — muitos mapas, muitas entidades — o delta entra **atrás do adapter**, e o resto do
sistema não muda. Otimizar antes de medir seria o erro aqui.

---

## #10 — Fog com quatro estados: revelado pelo mestre ≠ explorado

**Contexto.** O protótipo tinha três estados (nunca visto / já visto / visível agora). Ao levar a
ferramenta de "revelar" do mestre para o servidor, apareceu o problema: `computeVision` rebaixa
"visível agora" para "já visto" a cada passo. Uma sala revelada **de propósito** pelo mestre
escurecia sozinha no passo seguinte de qualquer token.

**Decisão.** Quarto estado, `FOG_REVEAL = 3`: revelado pelo mestre, permanente e imune ao recálculo
de visão. Fica só no servidor (`map:fog { op: "reveal" }`); o cliente desenha 2 e 3 como visível.

**Consequências.** "Revelar" e "explorar" viram coisas distintas, que é o que eles são na mesa. A
regra de visão ficou com uma linha de exceção em vez de uma condição especial espalhada pelo render.

---

## #11 — Um `SITE_ADDRESS` só, com `:80` como padrão

**Contexto.** O `deploy/Caddyfile` tinha quatro blocos prontos (DuckDNS, IP fixo + sslip.io,
Tailscale, HTTP puro) e o ativo era um domínio fixo (`helio.duckdns.org`). Resultado: `docker compose
up` num computador sem DNS apontando para ele e sem portas abertas ficava tentando emitir
certificado para sempre, e o site não subia. O primeiro contato com o projeto era um erro.

**Decisão.** Um **único** bloco de site no Caddyfile, endereço vindo de `SITE_ADDRESS` (no
`deploy/.env`, com padrão `:80` no `docker-compose.yml` via `${SITE_ADDRESS:-:80}`).
`:80` é um *catch-all*: responde em qualquer host que aponte para a máquina — `localhost` **e** o IP
da LAN — sem DNS, sem certificado, sem porta aberta. Os quatro cenários viram valores dessa
variável, documentados em `.env.example` e em `DEPLOY.md`.

**Consequências.** `docker compose up -d --build` funciona de primeira em qualquer máquina, e o grupo
testa na rede local antes de mexer em roteador. Trocar para HTTPS é editar uma linha e subir de
novo. O preço: o padrão é HTTP puro, que quebra voz/WebRTC quando chegar a Fase 4 — aceitável, já
que nesse momento o endereço será um domínio de qualquer forma. Efeito colateral do mesmo ajuste: o
`encode` do Caddy saiu do site e foi para dentro do `handle` do front, para nunca comprimir o
`/socket.io` (comprimir WebSocket quebra a conexão).

---

## #12 — Entrada: senha única de mestre (`GM_KEY`) até o RBAC

**Contexto.** Ao decidir expor o servidor na internet, apareceu um problema que não existia na LAN:
`room:join` dava o papel de mestre a quem **pedisse** (`wanted === "gm" => "gm"`), e mais: o primeiro
que entrava virava mestre por acaso. Num endereço público isso é entregar a mesa ao primeiro que
chegar. E "ninguém vai achar" não é defesa: o hostname de um certificado Let's Encrypt é publicado no
log de Certificate Transparency, ou seja, fica catalogado e pesquisável (`crt.sh`) no minuto em que o
HTTPS sobe.

**Decisão.** Uma senha única, `GM_KEY`, conferida no `room:join` (comparação de tempo constante).
Entrar como **jogador** não pede nada; entrar como **mestre** exige a senha. Sem `GM_KEY` definida, o
comportamento antigo continua e o servidor avisa no log que está sem senha. Senha errada é **recusada
com ack** (`{ ok: false, error }`) em vez de rebaixar em silêncio para jogador — rebaixar faria a
pessoa não entender por que não consegue mexer no mapa. O cliente guarda a senha no navegador, então
o mestre digita uma vez.

**Consequências.** O risco real (estranho assume a mesa) está coberto com uma variável de ambiente e
um campo no lobby. O que **não** está coberto, e é de propósito: não há conta, identidade estável nem
permissão por token — a identidade segue sendo o id do socket, quem sabe a senha é mestre, e jogador
pode ler o mapa todo. Também é uma senha compartilhada entre todos os mestres, sem como revogar um
só. Isso é aceitável enquanto é mesa de amigos; **RBAC de verdade é a Fase 4**, e é para lá que este
ADR aponta. Duas redes de segurança para não ficar exposto por esquecimento: o log do servidor ao
subir e o `deploy/check-publico.ps1`, que avisa quando as portas estão abertas e a senha vazia ou
óbvia.
