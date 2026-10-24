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

## #13 – Publicar portas só em IPv4; IPv6 global fica fechado

**Contexto.** Ao investigar o risco de abrir 80/443 para a internet, um teste com um serviço de
leitura remoto (`r.jina.ai`) mostrou que o jogo **já estava acessível da internet** mesmo com o IPv4
fechado. A resposta vinha pelo IPv6: esta máquina tem IPv6 global (`2804:18e4:...`), o provedor
entrega IPv6 por Router Advertisement, e o Docker publicava a porta 80 em `[::]` (todos os endereços
IPv6). Como IPv6 **não tem NAT**, não existe "porta fechada por padrão": tudo que escuta está
exposto. O `SITE_ADDRESS=:80` (catch-all) piorava, porque qualquer `Host` serve a página — nem
domínio era preciso para chegar.

**Decisão.** No `docker-compose.yml`, as portas do Caddy passam a ser publicadas em `0.0.0.0` (IPv4,
que é o que o port forwarding usa) e em `[::1]` (loopback IPv6, só para `http://localhost`
continuar funcionando). Nunca em `[::]`. O IPv6 da rede deixa de chegar no Caddy pelo Docker; a
correção de fundo — o firewall IPv6 do roteador, que protege a casa inteira — fica documentada em
`DEPLOY.md`, pegadinha #4.

**Consequências.** Foi preciso trocar `"80:80"` por entradas explícitas, e uma recriação do
container: a primeira tentativa falhou com `[::1]:80 already in use` (corrida com o proxy antigo
ainda fechando; subir de novo resolveu). Verificado antes/depois com o mesmo serviço externo —
antes, uma requisição com `User-Agent` de Linux (não esta máquina Windows) chegou e foi registrada
no log do Caddy com status 200; depois, erro de conexão e nada no log. `localhost`, `127.0.0.1` e
`192.168.1.69` seguem em 200, e o Socket.IO continua passando pelo Caddy. A lição generalizável:
**em IPv6, expor é o padrão e proteger exige ação** — o oposto do IPv4, e a razão de isto não
aparecer em tutorial nenhum de port forwarding.

## #14 – Expor por Cloudflare Tunnel, em vez de port forwarding

**Contexto.** Três restrições juntas apontaram para longe do port forwarding: (a) não expor portas
do PC pessoal, (b) não depender de configuração de roteador, (c) jogadores sem acesso a
configuração. O IPv6 parecia a saída fácil — "não tem NAT, não precisa de porta aberta" — e caiu
pelos dados do próprio provedor: em 10 sessões PPPoE desde 31/08 o IPv4 ficou sempre
`201.158.22.220`, mas o prefixo IPv6 delegado mudou **10 vezes**, duas delas no mesmo dia, a cada
`Lost-Carrier`. Como o endereço IPv6 entra no nome (`...sslip.io`), a URL mudaria no meio da
partida. O IPv4 fixo com port forwarding resolveria, mas exige mexer no roteador e deixa o PC
escutando na internet.

**Decisão.** Um serviço opcional `cloudflared` no `docker-compose.yml`, atrás do profile `tunnel`,
apontando para `http://caddy:80`. Ele abre uma conexão de **saída** para a Cloudflare e publica o
Caddy por ali: nenhuma porta de entrada, IP de casa escondido, HTTPS na borda, e o jogador só clica
no link. O `profile` existe de propósito: o túnel **não sobe por acidente** com um `up -d` normal,
e nada no caminho antigo (LAN, localhost, port forward) muda.

**Consequências.** Verificado de ponta a ponta: o smoke passou **15/15 contra a URL pública**, o que
exercita o Socket.IO e o WebSocket através da Cloudflare, e a página carrega por HTTPS. No modo
rápido (`--url`, sem conta e sem domínio) a URL é sorteada e troca a cada reinício — aceitável para
teste e apresentação — mas, por ser subdomínio de certificado coringa, **não entra no log de
Certificate Transparency**: é um link não-listado, que não é achado por varredura. Isso importa
porque um domínio próprio, ao contrário, aparece no `crt.sh` no minuto em que o certificado sai.

O que continua em aberto, e é preciso dizer com todas as letras: **o túnel melhora o transporte, não
o aplicativo.** Quem tiver o link ainda entra como jogador sem senha; o `fog:discover` continua sem
validação no servidor, então qualquer jogador pode apagar o fog de guerra inteiro numa mensagem; não
há limite de taxa, então um cliente em loop trava a mesa (cada evento transmite a cena toda); o
container do `app` roda como root; e o CORS aceita qualquer origem. Nenhum desses é resolvido por
IPv4, IPv6, túnel ou Tailscale — são correções de aplicação, e ficam como próximo passo.
Para uso contínuo, o complemento natural é domínio na Cloudflare + Access (até 50 usuários grátis),
que barra na borda e se aproxima de "login com autorização" sem escrever RBAC.

## #15 – Fechar os buracos de aplicação: fog, limite de taxa e container

**Contexto.** Fechado o transporte (ADR #13 e #14), sobrou o que nenhum deles resolve: os buracos do
próprio servidor. Uma revisão do código encontrou quatro, todos verificados:

1. `fog:discover` era completamente confiado ao cliente. Qualquer jogador mandava as células que
   quisesse e elas viravam "explorado" para a mesa inteira, permanente — ou seja, **uma mensagem
   apagava o fog de guerra de todos**. Não era hipótese: é literalmente a função do evento, sem
   validação. Medido: o tabuleiro inteiro (660 de 660 células) ia de uma vez só.
2. Sem limite de taxa. E cada evento aceito transmite a **cena inteira** para todos os jogadores,
   então um cliente em loop multiplica o custo por jogador. Node é single-thread: a mesa trava.
3. O container do `app` rodava como **root**.
4. CORS `origin: true` aceitava qualquer origem, então uma página maliciosa podia abrir um socket
   aqui a partir do navegador da vítima.

**Decisão.**

- `fog:discover` passa a ser validado: o servidor recalcula a visão de **todos os atores** com
  `visibleCellsFrom` — a mesma função que o cliente usa — e aceita só célula dentro dela. A escolha
  do conjunto é o ponto fino: usar a união (e não apenas o token de quem manda) mantém o
  comportamento atual intacto, porque é exatamente o que `reportNewFog` reporta. Nada legítimo é
  recusado, e o ataque morre por inteiro. O corte por jogador é a Fase 3.
- Teto de 5000 células por mensagem (o maior tabuleiro possível é 80x60 = 4800) e payload máximo de
  256 KB, então um payload absurdo nem chega a ser percorrido.
- Limite de taxa por conexão: token bucket de 60 eventos/s com rajada de 150, aplicado no middleware
  de pacote do Socket.IO — vale para todo evento, inclusive os que ainda não existem. Pacote acima
  do limite é descartado em silêncio; 600 descartes seguidos derrubam a conexão. Os números são ~15x
  o uso legítimo de propósito: limite apertado atrapalharia mais quem joga do que quem ataca.
- Handshake só de mesma origem (`allowRequest`): `Origin` de outro site leva 403. Requisição sem
  `Origin` (script, teste) passa — sem navegador, não há o que enganar.
- Container: `USER node` na imagem, e no compose `read_only`, `/tmp` em tmpfs, `cap_drop: [ALL]` e
  `no-new-privileges`. O processo não escreve em disco (as salas vivem em memória), então dá para
  tirar o disco de escrita inteiro.

**Consequências.** O smoke passou de 15 para 19 checagens, com duas novas que valem como
documentação executável: "tabuleiro inteiro numa mensagem não revela o mapa (60 de 660)" — antes
dava 660 de 660 — e "rajada acima do limite é descartada em silêncio", seguida de "o limite não
trava o jogador para sempre". Verificado também de fora, pela URL do túnel: 19/19. E o handshake de
mesma origem respondeu 200 para a origem própria e 403 para uma estranha, tanto pelo túnel quanto
local.

O que continua em aberto, de propósito: **jogador ainda entra sem senha** (o `GM_KEY` protege só o
papel de mestre), a identidade segue sendo o id do socket, e não há visão por jogador — todos
recebem todos os atores. Esses três são RBAC e Fase 3, não descuido.

## #16 – Identidade: conta, sessão assinada e o fim do `GM_KEY`

**Contexto.** A identidade hoje é o id do socket: existe enquanto a conexão existir. Três
consequências caem todas no mesmo lugar. Recarregar a página te transforma em um estranho (o
servidor não tem como saber que você é o mesmo de antes). O papel de mestre é um **segredo
compartilhado** (`GM_KEY`), então "ser mestre" é uma coisa que se sabe, não uma coisa que se é —
não dá para ter dois mestres diferentes, nem revogar o acesso de um sem trocar a senha de todos.
E não existe "seu": nada que o servidor guardar tem dono. RBAC e persistência, portanto, são
ambos reféns disto — e por isso vêm juntos (ADR #17).

**Decisão.**

- **Conta** na tabela `account`. Senha com **`scrypt` do `node:crypto`**: sem bcrypt, sem
  dependência nova, ~5 linhas. Formato `scrypt$N$r$p$salt$hash`, salt aleatório por conta,
  comparação de tempo constante. Senha em texto puro **nunca**, nem em teste.
- **Sessão assinada**, sem estado no servidor: `HMAC-SHA256` sobre `{accountId, iat, exp}` com a
  chave em `SESSION_SECRET`. Sem tabela de sessões significa que reiniciar o container **não
  desloga ninguém**.
- O token viaja num cookie **`HttpOnly`**, `SameSite=Lax`, `Path=/`, validade de 30 dias, e
  `Secure` sempre que houver HTTPS.
- **O ganho de graça:** o Socket.IO envia os cookies do mesmo domínio no handshake. A identidade
  chega na conexão **sem inventar mensagem nova** — `socket.data.accountId` é resolvido uma vez,
  ali. É o argumento técnico que faz o desenho ficar simples em vez de esperto.
- **Papel vem do vínculo** com a campanha (`membership.role`), não de uma senha. O `GM_KEY`
  continua aceito como caminho de bootstrap enquanto o resto migra, e depois sai — o ADR #12
  fica superado.
  *(Emenda da entrega 4, ADR #19: o vínculo virou o caminho de verdade e o `GM_KEY` virou legado
  assumido. Ele **não** sai antes de existir recuperação de senha — senão um mestre esquecido tranca o
  grupo de fora. Ver também o cadastro em `POST /api/accounts`.)*
- **Mestre exige conta.** Jogador pode entrar como **convidado** (só nome); aí a identidade é do
  socket, como hoje, e isso é dito com todas as letras em vez de parecer que não é.

**Consequências.** `room:join` deixa de receber `role`/`key` como fonte de verdade (viram legado
tolerado por um tempo). Surge `SESSION_SECRET` no ambiente, gerado com
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Como não há estado de
sessão, **não existe logout no servidor**: sair apaga o cookie. Revogar uma sessão específica
exigiria tabela, e isso fica anotado como limite conhecido em vez de ser vendido como completo. O
lobby avisa que a senha é temporária — recuperação de senha e RBAC ainda não existem. Em `:80`
local o cookie **não** é `Secure`, porque não há HTTPS; é a exceção consciente. Contra CSRF, o que
protege é o conjunto: `SameSite=Lax`, só mesma origem (o handshake já recusa `Origin` estranho) e
rotas de autenticação serem `POST`.

**Emenda (entrega 2, o que a prática corrigiu).**

- **O `Secure` não pode sair do `X-Forwarded-Proto`.** O Caddy termina o TLS do túnel e repassa a
  requisição em HTTP puro, então esse cabeçalho diz `http` **mesmo numa visita HTTPS** — a sessão
  pública estava saindo sem `Secure`, que é o cenário clássico de roubo de cookie. Quem sabe a verdade
  é a borda da Cloudflare (ADR #14), que marca a requisição; a marca é o que o servidor passa a
  olhar. Isso acopla o `Secure` ao caminho de exposição atual, e é um acoplamento aceito: errar para o
  lado do `Secure` só restringe, e o acesso direto na LAN não tem marca nenhuma e segue funcionando.
- **O limite de tentativas de login é global, não por IP.** Atrás do túnel e do Docker todo mundo
  chega com o mesmo IP de origem (o gateway do compose): um limite por IP seria um limite
  compartilhado, e o primeiro a abusar travaria o grupo inteiro. O teto global protege o que importa —
  `scrypt` é caro de propósito e o mesmo processo está servindo a partida.
- **A conta é lida uma vez por conexão, no escopo da conexão**, e não guardada em `socket.data`. Mesma
  promessa (resolvida no handshake, sem mensagem nova), sem espalhar estado mutável pelo socket.
- **`/api` virou o prefixo de tudo que o servidor responde em HTTP.** A primeira versão listava rota
  por rota no `Caddyfile` (`/auth/*`), e esquecer uma significava cair no `try_files` da SPA e receber
  o `index.html` com **status 200** — erro que se disfarça de sucesso. Aconteceu duas vezes: primeiro
  com `/auth/*`, depois com `/campaigns`. Com um prefixo só, o Caddy manda `/socket.io/*` e `/api/*`
  para o app e o resto é arquivo estático: rota nova dentro do prefixo não tem como ser esquecida, e
  rota que falta vira 404 de verdade.

**Emenda da entrega 5 (ADR #20).** A conta deixou de ser um upgrade e virou a porta: sem sessão válida,
`room:join` recusa, e o cliente parou de mandar nome e papel. Sem `SESSION_SECRET` não há login — e
portanto não há mesa.

## #17 – Persistência: Postgres, campanha com Selo da Missão e cena em JSONB

**Contexto.** As salas vivem em memória e nada é escrito em disco — decisão explícita do ADR #15,
que comprou segurança (`read_only`, sem root) ao preço de esquecer tudo. Reiniciar o container
apaga a mesa; e não existe lugar nenhum para guardar conta, campanha ou ficha. Além disso, o
`ROOM_CODE` é um valor fixo do `.env`: uma mesa só, com um código que todo mundo conhece.

**Decisão.**

- **Postgres** como serviço do `docker-compose.yml`, com volume nomeado e `healthcheck`. Driver
  **`pg`** — **não Prisma**: o Prisma carrega um binário de engine que quer escrever em runtime, e
  o `app` roda `read_only` e sem root. SQL tipado com `pg` não tem esse problema.
- A porta é publicada **só no loopback** (`127.0.0.1:5432:5432`), para desenvolvimento. Nunca em
  `0.0.0.0` — mesma lição do ADR #13, agora para um banco com senha.
- **Migrations em SQL numerado** (`001_init.sql`, ...) com um runner pequeno que aplica em
  transação e registra o que já rodou em `schema_migrations`. Sem framework; dá para ler tudo.
- **Esquema:**
  - `account (id, name unique, password_hash, created_at)`
  - `campaign (id, code unique /* Selo da Missão */, name, gm_account_id → account, created_at)`
  - `membership (account_id, campaign_id, role, created_at)` — chave primária composta
  - `scene (campaign_id PK → campaign, data jsonb, updated_at)`
- **Selo da Missão** é `campaign.code`. Substitui o `ROOM_CODE` fixo: cada mesa tem o próprio selo, e
  o `ROOM_CODE` vira só a conveniência padrão.
  *(Emenda: o formato previsto aqui — alfabeto sem `0/O`, `1/I/L` — foi trocado na entrega 3 por
  **três palavras e dois dígitos** (`CORVO-AMBAR-VEU-74`). Ver o ADR #18: palavras sem acento são
  ditáveis e não têm caractere ambíguo nenhum, o que resolve o mesmo problema sem código ilegível.)*
- **Cena em JSONB**, com `schemaVersion` dentro. As regras do sistema ainda não estão fixadas — a
  ficha vai ser inventada na mesa —, então coluna rígida brigaria com o autor. JSONB + versão
  deixa evoluir sem migration de esquema. A ficha segue o mesmo princípio quando chegar.
- Gravação **com debounce**: alguns segundos depois da última mudança, mais um flush quando o
  último jogador sai. A cena viva continua em memória (rápida, como hoje) e o banco é a cópia
  durável. Gravar a cada evento seria amplificação de escrita por nada.
- **`ownerId` do ator é um socket, e não é persistido.** O token de jogador nem chega ao banco: ele
  pertence à sessão, e volta a existir quando o jogador entra de novo. Os NPCs ficam, sem dono —
  quem controla é o mestre até alguém assumir. Gravar socket id seria gravar lixo que não sobrevive
  a um restart.
- **Degradação, não queda:** se o banco estiver fora, o servidor **sobe**, registra o erro e a
  mesa funciona em memória como hoje. Derrubar a partida por causa do banco seria pior do que não
  ter banco.

**Consequências.** Surge `DATABASE_URL`. Subir a stack passa a subir o Postgres; rodar o servidor
fora do Docker (para desenvolvimento) precisa apontar para o Postgres do próprio compose, que é o
motivo de ele estar publicado no loopback. Backup deixa de ser opcional e vira responsabilidade:
`pg_dump` do volume entra no `DEPLOY.md`. E fica dito que isto **não** é compressão: `walls` e
`fogExplored` continuam indo como arrays, na rede e no banco; bitset/RLE segue sendo assunto
separado, de propósito.

## #18 – Selo da Missão: campanha se cria de propósito, com código gerado e legível

**Contexto.** A entrega 1 criou a campanha **de carona**: entrar com um selo qualquer criava a linha
na hora (`ensureCampaign`). Isso mantinha o comportamento antigo e deixava o furo anotado — qualquer
um com a URL cria campanha sem limite, e o banco encheu de `SMOKE-*` e `AUTH-*` só de rodar teste.
Ao mesmo tempo ficou claro o que o selo **é** de verdade: convidado não tem conta, então o selo é o
convite dele. Um código adivinhável é uma porta aberta.

**Decisão.**

- **Criar é um ato deliberado, e exige conta.** `POST /api/campaigns` (autenticado) cria a campanha e
  torna a conta a **dona** (`gm_account_id`) — o que, pelo ADR #16, já dá o papel de mestre sem senha.
  `GET /api/campaigns` lista as do dono, porque perder o selo é o mesmo que perder a mesa: ele precisa
  poder consultar de novo. `DELETE /api/campaigns/:selo` é do dono, e é o par obrigatório do criar —
  sem ele, cada selo abandonado é lixo permanente.
  *(Emenda da entrega 4, ADR #19: dono e mestre se separaram — o dono administra, e quem comanda a mesa
  é o vínculo (`membership.role`). Por isso a lista passou a ser "as que criei **e as que entrei**", com
  o papel de cada uma.)*
- **Selo desconhecido não entra, e não cria nada.** Sem linha, sem sala em memória. `room:join`
  devolve `{ok:false}` com o motivo, para o lobby explicar em vez de deixar a pessoa num socket
  conectado que não está na mesa.
- **O selo é gerado pelo servidor: três palavras e dois dígitos** (`CORVO-AMBAR-VEU-74`). Ditável em
  voz alta, sem código fraco escolhido com pressa e sem dois mestres disputando o mesmo nome.
  Palavras **sem acento** e distintas entre si; tolerância de digitação fica com `normalizeCode`, que
  passa a **remover acentos** (quem ouvir "âmbar" e digitar `ÂMBAR` acerta do mesmo jeito). O nome
  humano da missão ("A Maldição de Veríssimo") mora em `campaign.name`, separado do código.
- **O nome não é segredo; o selo é.** Por isso os dois não se derivam: batizar a missão não pode
  determinar o convite.
- **`ROOM_CODE` deixa de ser "o código que cria a sala"** e vira o **selo sugerido** do lobby. É
  criado no boot **apenas quando o banco está vazio** — o primeiro boot precisa de uma missão para o
  grupo entrar, mas um selo que ressuscita a cada restart seria surpresa ruim: apagar a missão padrão
  e vê-la voltar é o tipo de mágica que faz duvidar do que ficou salvo. Apagada com outras missões
  existindo, ela fica apagada.
- **Banco fora não recusa selo.** O veredito precisa de banco: sem ele não há como confirmar campanha
  nenhuma, e recusar todo mundo transformaria "banco caiu" em "mesa não abre" — exatamente o que o
  ADR #17 proíbe. A consulta distingue **"não existe"** de **"não deu para saber"**: no primeiro caso
  recusa, no segundo entra em memória como antes.
- **Errar o selo custa caro.** Cada conexão conta tentativas de selo errado e é derrubada ao passar do
  limite. Sem isso, adivinhar vira uma conta de probabilidade contra o único evento que precisa de
  palpite.

**Consequências.** O lobby ganha a lista de missões da conta e o botão de criar — só para quem entrou;
convidado continua digitando o nome e o selo, e o último selo fica guardado no navegador para não
digitar de novo. Os testes param de criar lixo: passam a criar a campanha de que precisam e **apagar
no fim** (com a degradação para selo aleatório, para continuarem rodando com o banco fora, que é um
modo que a mesa precisa suportar). `GM_KEY` continua valendo como bootstrap — o caminho de mestre por
conta e o legado convivem (na entrega 4 o papel passou a vir do vínculo; ver ADR #19).

**Emenda da entrega 5 (ADRs #20 e #21).** O convidado saiu: quem entra pelo selo é uma conta, e a mesa
mostra o nome dela. A lista de missões e o campo do selo moraram para a página `/mesa`, junto do papel
que o servidor vai dar — o selo continua guardado no navegador, e o resto da mecânica não mudou.

## #19 – A conta do agente: cadastro com freio, e o papel de mestre vem do vínculo

**Contexto.** A entrega 3 fechou o selo, mas deixou um buraco que só apareceu ao usar: **só existe uma
conta possível**, a do mestre, semeada no boot. Sem jeito de criar conta, "papel pelo vínculo com a
campanha" (a entrega 4) não significaria nada — não há segundo membro para o vínculo valer — e os
amigos do grupo continuariam redigitando o nome toda sessão, que era exatamente o que a conta veio
resolver.

**Decisão (1): dá para criar a própria conta, e essa é uma porta que se fecha.**

- **`POST /api/accounts`** cria a conta (nome de 2 a 24 caracteres, senha de 6 a 200) e **já devolve o
  cookie de sessão**: quem se cadastra entra. Não existe tela de "agora digite o que você acabou de
  digitar".
- **O cadastro é aberto por padrão, com teto e interruptor.** `REGISTRATION=closed` fecha (o lobby para
  de oferecer, o servidor responde 403) e `REGISTER_PER_MINUTE` limita a rajada. Uma tela de
  administração para aprovar conta seria muito mais código para um problema que dura uma tarde.
- **O que um cadastro entrega a um estranho é pouco**, e é por isso que o freio é modesto: entrar ainda
  exige o Selo da Missão, e ser mestre ainda exige vínculo. A conta sozinha não abre mesa nenhuma. O
  limite existe para não entupir o `scrypt`, que é caro de propósito e roda na mesma thread da partida.
- **`GET /api/auth/me` diz se o cadastro está aberto** (`signup`), junto de "quem sou eu": o lobby
  precisa saber antes de oferecer o formulário.
- **Nome repetido é dito na cara aqui — no login, não.** É a única assimetria, e ela é inevitável: o
  `unique` recusaria de qualquer jeito, e uma mensagem genérica só faria a pessoa tentar de novo à toa.
  No login a resposta continua cega, porque ali não custa nada ser cego.

**Decisão (2): o papel de mestre mora no vínculo, não em ser dono.**

- **`membership.role` decide quem é mestre na mesa.** O critério antigo era "é a conta dona da
  campanha": dava no mesmo enquanto só existia uma conta, e travava um co-mestre — que precisaria criar
  outra campanha ou pegar a senha compartilhada emprestada.
- **Dono e mestre deixaram de ser a mesma coisa.** `campaign.gm_account_id` é o **dono** (administra:
  apaga a missão, aparece como dono na lista). `membership.role = 'gm'` é o **mestre** (comanda a
  mesa). Hoje só quem cria é dono, então quem cria é as duas coisas.
- **Quem cria vira mestre na mesma instrução.** Campanha e vínculo são duas tabelas, e se a segunda
  falhasse o dono ficaria sem o papel de mestre na própria missão — erro silencioso e cruel. Um CTE que
  escreve resolve: no Postgres ele roda inteiro ou não roda.
- **`membership` ganha backfill obrigatório** (`002_vinculo_gm.sql`): sem ele, o mestre de hoje perde o
  papel no primeiro boot. Promove quem já tinha vínculo de jogador na própria campanha — quem criou a
  mesa é mestre dela, por definição.
- **Estar na mesa é ser agente dela; ser mestre é outorga explícita.** Entrar grava vínculo de jogador,
  e o conflito não rebaixa ninguém: um mestre pode querer jogar como agente numa sessão. Sem essa
  regra, entrar com a `GM_KEY` — uma senha compartilhada — promoveria a pessoa para sempre, em
  silêncio.
- **A lista do lobby passa a ser "minhas mesas", não "minhas campanhas"**: as que criei e as que
  entrei. É o caminho do agente para não redigitar o selo, com o papel de cada uma à mostra e o `×` só
  para o dono — que o servidor confere de novo. A lista é conveniência; quem autoriza é o servidor.

**Consequências.** O `GM_KEY` não foi embora, e agora está dito por quê: **sem recuperação de senha,
tirá-lo trancaria o grupo de fora** se o mestre esquecesse a senha — ou se o `SESSION_SECRET` fosse
trocado, o que desloga todo mundo de uma vez. Ele virou legado explícito (o boot diz, o lobby diz) e sai
quando existir recuperação de senha, não antes. Ficam pendentes, de propósito: promover um agente a
mestre (a linha existe, falta o botão), apagar a própria conta (mexe em campanha órfã) e renomear
missão.

**Emendas das entregas 5 e 6 (ADRs #20 e #22).** O botão chegou — e a promoção vale **na hora**, por uma
ponte entre o HTTP e a mesa viva. O cliente parou de mandar `role`: entrar como agente sem vínculo não é
mais possível, e quem é mestre entra como mestre sem digitar nada. "Entrar como agente" deixou de
significar "sem vínculo".

---

## #20 – A conta é a porta: sem sessão não se entra, e o papel não se pede

**Contexto.** A entrega 4 fez o papel vir do vínculo e o nome vir da conta — e deixou o convidado de pé. Ele
não sobreviveu ao uso: sem conta não há vínculo (logo, não há como ser promovido), não há nome estável (o
nome morria com o socket) e não há linha em `membership` (logo, a lista de missões nunca o encontraria). Pior:
o cliente **ainda mandava `role: "gm"`** no `room:join`. O servidor já ignorava o valor e decidia pelo
vínculo, mas o campo continuava ali, uma mentira esperando alguém confiar nela. Enquanto o nome e o papel
eram digitados, "a mesa exige conta" não passava de uma boa intenção.

**Decisão (1): sem conta não se entra.**

- **`room:join` recusa sem sessão válida** — `{ ok: false, error: "Entre com a sua conta para jogar." }` — e
  recusa **antes** de olhar o selo: selo nenhum é consultado, sala nenhuma é criada. O caminho do convidado
  não virou exceção; virou erro.
- **A recusa é a mesma sem `SESSION_SECRET`.** Sem a variável não existe login, e a mesa **não abre no
  escuro**: um servidor que aceita qualquer um porque a sessão está desligada é um servidor que ninguém sabe
  que está desligado. O boot grita sobre a variável que falta (e o teste de fumaça falha dizendo o mesmo).
- **O que o ADR #17 promete continua valendo**: a sessão é assinada e **não mora no banco**, então banco fora
  não derruba quem já está logado. O que morre com o banco é o selo (que precisa ser julgado) — e o
  `CampaignLookup` continua distinguindo "não existe" de "não deu para saber".

**Decisão (2): o cliente manda o convite, o servidor decide quem você é.**

- **O payload é `{ code, key }`.** Nome e papel saíram. O nome é o **da conta** (`MAX_NAME` e o campo de nome
  foram embora junto), e o papel é calculado no servidor:
  `memberRole === "gm" || chave certa ? "gm" : "player"`.
- **A chave continua sendo uma declaração de intenção, e só isso.** Vazia não declara nada: você entra como
  agente, mesmo sendo mestre (um mestre pode querer jogar). Digitada, ela diz "quero entrar como mestre" — e
  se a conta não tem vínculo e a chave está errada, a resposta é **"Senha de mestre incorreta."**, não um
  rebaixamento silencioso. Quem **tem** vínculo ignora a chave errada: a identidade vence o acidente de
  digitação.
- **`GM_KEY` vazia agora fecha a escapatória.** Antes, vazio significava "sem senha — qualquer um é mestre", o
  que só era aceitável numa rede local sem contas. Com conta obrigatória, "sem senha" seria entregar a mesa a
  qualquer conta que digitasse qualquer coisa: vazio passou a significar **nenhuma escapatória**, e o vínculo é
  o único caminho. Quem precisa de escapatória configura uma.

**Consequências.** O convidado saiu dos docs, dos testes e do código (`selo.mjs` passou a entrar com a conta
de teste; `auth.mjs` ganhou a recusa explícita). O custo de entrada virou um nome e uma senha — e, se o
cadastro estiver fechado, **não há como criar conta**: fechar `REGISTRATION` agora é uma porta que se fecha
para sempre até reabrir (ver `DEPLOY.md`). Ficam pendentes, e agora mais visíveis: **não existe recuperação
de senha** (esquecer a senha = criar outra conta = outra identidade, sem os vínculos) e **não existe apagar
conta**.

---

## #21 – Páginas: cada tela faz uma pergunta

**Contexto.** A entrada era **uma** tela com o endereço do servidor, o formulário de conta, a "Identificação
na Ordem" (nome + *mestre/agente*), a lista de missões, o selo, a senha de mestre e o link do modo local.
Dois desses campos não faziam o que pareciam: `role` era ignorado pelo servidor (o vínculo decidia) e o nome
era ignorado para quem tinha conta. Uma tela que pergunta sete coisas e ignora duas ensina a pessoa a
desconfiar do formulário inteiro. O pedido foi direto: *"1 pro login e cadastro, 1 pra selecionar a
campanha"*.

**Decisão.** React Router (v7), com URLs de verdade — porque "página" sem endereço não é página, é etapa de
assistente que ninguém consegue mandar por link:

| Rota | Pergunta | O que tem |
|---|---|---|
| `/entrar` | *quem é você?* | entrar ou criar conta (a aba de criar só existe se o servidor aceitar, `signup`); endereço do servidor em "opções avançadas"; link para o modo local |
| `/mesa` | *em qual missão?* | a conta (e **Sair**), as missões com criar/escolher/apagar, a "Identificação na Ordem" **somente leitura**, o selo, a senha de mestre escondida, **Ingressar** |
| `/` | *a mesa* | o mapa, e só com `status === "online"` |
| `/local` | *a mesa sem servidor* | o mapa de preparação, com saída no topo |
| `*` | — | volta para `/` |

- **A cadeia de guardas resolve o resto**: `/` sem conexão manda para `/mesa`; `/mesa` sem conta manda para
  `/entrar`; `/entrar` com conta manda para `/mesa`. Ninguém precisa decorar a ordem.
- **`ready` existe por causa do piscar.** A sessão vive num cookie `HttpOnly`: o cliente **pergunta** quem é
  (`GET /api/auth/me`). Sem um "já perguntei", toda visita a `/mesa` mostraria o formulário por um instante
  para quem já estava logado. `sessionStore.ready` é essa resposta, e as guardas esperam por ela.
- **A identidade é a pessoa, não o personagem.** "Identificação na Ordem" mostra **o nome da conta** e o papel
  que o servidor vai dar, em vez de pedir os dois. Ficha de agente, quando existir, é outra tela e outro nome.
- **O endereço do servidor mudou de lado.** Ele fica em `/entrar` porque vale para `/api` e para o socket ao
  mesmo tempo (ADR #16) — quem digita ali espera entrar **naquele** servidor, e não num para a conta e noutro
  para o jogo.
- **O que sobrevive ao F5 fica no navegador**: o último selo e a última chave de mestre (nunca a senha). O
  resto vive nos stores (zustand), não na página.

**Consequências.** O `Lobby.tsx` (1025 linhas) virou três arquivos com um só assunto cada: `screens/Shell.tsx`
(a moldura e a trilha *1 Conta · 2 Missão*), `screens/Entrar.tsx` e `screens/Mesa.tsx`. O Caddy **não mudou**:
o `try_files {path} /index.html` da entrega 2 já servia link fundo. Sair da mesa passou a existir de verdade
— no modo local é só navegar, e na mesa **desconecta** (o servidor solta o token, como fechar a aba), o que
também permite trocar de missão sem F5. Recarregar o `/` perde a conexão e cai em `/mesa`: é honesto (o socket
morreu), e o selo guardado deixa a volta a dois cliques. **Reentrar automático não foi feito** — ele
escolheria uma missão pela pessoa.

---

## #22 – O mestre outorga o papel, e a promoção vale na hora

**Contexto.** O ADR #19 deixou a linha de `membership` pronta e o botão faltando. O pedido foi exatamente
esse: *"mestre pode dar a permissao ou dar o lider do ato. q ai vira mestre"*. A pergunta boa não era "como
gravar" (é um `upsert`), e sim **como fazer valer numa mesa que já está aberta** — a pessoa promovida está
conectada, e esperar o próximo F5 é o mesmo que não ter promovido.

**Decisão.**

- **`POST /api/campaigns/:selo/role`** com `{ name, role: "gm" | "player" }`, exigindo conta. Pode outorgar
  **quem já é mestre ali**: o dono ou qualquer conta com `membership.role = 'gm'` naquela missão — um
  co-mestre precisa montar a própria equipe. Quem não é recebe **404**, a mesma resposta de "selo não
  existe", para não entregar quais selos existem nem quem manda em quê.
- **O alvo é o nome da conta**, não o id: é o nome que o painel mostra, e o `unique` de `lower(name)` garante
  que ele aponta para uma conta só.
- **A permissão, o alvo e a gravação são uma instrução só** (um CTE que escreve: `pode`, `alvo`, `gravado`).
  Se o vínculo de quem outorga sumir no meio do caminho, nada é escrito — a checagem e o efeito não podem
  morar em transações diferentes.
- **O dono nunca é rebaixado** (400). Ele administra a missão (apaga, aparece como dono na lista); tirar o
  papel dele deixaria a caneta com uma pessoa e o volante com outra. Todo o resto é rebaixável, inclusive
  quem promoveu — o dono é a rede de segurança.
- **O efeito é imediato, e por isso existe `server/src/live.ts`.** A rota grava o vínculo e chama
  `roleChanged()`; `index.ts` — o único módulo que tem o `io` e o mapa de salas — registra um ouvinte que
  atualiza `room.players` e faz `broadcast(room)`. A ponte tem **uma** função e existe para os dois lados não
  se conhecerem: `http.ts` não importa o servidor de sockets, e `index.ts` não importa rotas. Trocar um por
  outro não move esta peça.
- **Promover não tira nada; rebaixar dá o que falta.** Um mestre não tem token; ao virar agente, ganha um
  token (e isso é cena, então é gravado). Promover mantém o token que a pessoa já tinha — ela só passou a
  poder tudo.
- **Na tela**, o painel da mesa (`PlayersPanel`) mostra para o mestre um botão por jogador: **olho** dá o
  papel de mestre, **espadas** devolve a agente. O servidor confere de novo; o botão é conveniência.

**Consequências.** Promover é **durável** (vínculo no banco, vale no próximo boot) **e imediato** (a sessão
aberta muda sem F5) — as duas coisas, porque uma sem a outra é uma promessa pela metade. Funciona também para
quem **não está conectado**: a rota grava o vínculo e a pessoa entra como mestre na próxima vez (a tela só
oferece o botão para quem está na sala). Um mestre pode rebaixar outro mestre, inclusive o que o promoveu:
aceito de propósito, com o dono como limite. A rota revela a um mestre se um nome de conta existe (400 "Conta
não encontrada") — o mestre já conhece o grupo, e o login continua cego para o resto do mundo. O papel deixou
de ser "decidido uma vez na entrada" apenas neste caminho controlado; a documentação da arquitetura passou a
dizer isso com essas palavras.
