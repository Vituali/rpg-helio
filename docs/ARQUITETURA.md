# Arquitetura

## Princípio central

> **O servidor é a única fonte da verdade. O cliente pede, o servidor decide.**

Todo VTT multiplayer quebra quando o cliente manda *verdades* ("estou na célula 5,7") em vez de
*intenções* ("quero ir para a célula 5,7"). O protótipo original (`FogWarMap.jsx`) faz tudo em
`useState` dentro do componente: ninguém mais no mundo vê esse estado. A Fase 0 existe justamente
para tirar o estado de dentro do React e dar a ele um lugar único, serializável, que depois vira
o estado do servidor.

A escala do projeto permite um luxo: **mandar o snapshot inteiro** a cada mudança em vez de deltas.
660 células de fog (`Uint8`) = 660 bytes; paredes como bitset = 83 bytes. Menos de 1 KB binário por
snapshot. Não vale a complexidade de delta ainda.

---

## Camadas do cliente

```
client/src/components/   UI React (FogWarMap, Lobby, PlayersPanel)
        │  lê/escreve via ações
        ▼
client/src/state/        gameStore + netStore (Zustand)
        │  │
        │  └─▶ net/      adapter de transporte (Socket.IO) — o ÚNICO lugar que fala socket
        │          ▲
        │          │ intenções voltam como `room:state`
        ▼          │
shared/src/      ◀─┘  lógica pura, sem React, sem rede, sem canvas:
                     grade, visão (LOS), pathfinding, colisão
        ▲
        │  o MESMO pacote
server/src/           valida as intenções e é a fonte da verdade
```

**Regra de ouro:** `shared/` não importa React, não importa canvas, não importa socket. É função pura
de `(estado, entrada) → saída`. Isso permite:

1. testar sem browser;
2. rodar **exatamente as mesmas** regras no servidor (validação) e no cliente (predição/desenho);
3. trocar transporte de rede sem tocar no jogo.

`render/` fica separado porque desenhar no canvas é efeito colateral: nada de lógica de jogo ali.

### Como `shared/` chega nos dois lados

| | Cliente | Servidor |
|---|---|---|
| import | `@helio/shared` | `@helio/shared` |
| resolução | alias no `vite.config.ts` + `paths` do tsconfig | `paths` do tsconfig, resolvido pelo `tsx` |
| execução | Vite/esbuild transpila | `tsx` executa TypeScript direto |

Um detalhe que custa caro se esquecido: `shared/package.json` **precisa** de `"type": "module"`.
Sem ele o `tsx` trata os arquivos como CommonJS e o `export *` se perde — o servidor sobe e explode
com "does not provide an export named…".

---

## Modelo de estado

```ts
type Role = "gm" | "player";
type Facing = "n" | "s" | "e" | "w";
type FogValue = 0 | 1 | 2 | 3;

interface Actor {          // token jogável (jogador, NPC, monstro)
  id: string;
  name: string;
  ownerId: string | null;  // null = NPC controlado pelo GM
  row: number;             // célula lógica confirmada
  col: number;
  facing: Facing;
  vision: number;          // raio de visão em células
  sprite: string;          // chave do spritesheet (bonequinho procedural)
  portrait: string | null; // PNG de retrato; tem prioridade sobre `sprite`
  color: string;
  canMove: boolean;        // permissão individual (por token)
  path: Cell[];            // SÓ no cliente: fila de passos previstos
}

interface Sector { id: string; name: string; r1: number; c1: number; r2: number; c2: number; color: string; }

/** O que o SERVIDOR guarda. */
interface Scene {
  cols: number; rows: number; cell: number;   // dimensões e tamanho da célula em px
  bgImage: string | null;                     // URL ou data URL
  fogMode: "soft" | "hard";
  walls: boolean[][];                         // obstáculo e bloqueio de LOS
  fogExplored: FogValue[][];                  // COMPARTILHADO e permanente (0 / 1 / 3)
  actors: Actor[];
  sectors: Sector[];
  version: number;                            // incrementa a cada mudança autoritativa
}

interface Player {
  id: string; name: string; role: Role;
  actorId: string | null;      // qual ator ele controla
  canMoveGlobal: boolean;      // liberação geral do GM
}
```

O cliente guarda o mesmo `Scene`, trocando `fogExplored` por `fog`: a união do que o servidor já
conhece (0/1/3) com a visão **atual** dos tokens dele (2), recalculada localmente a cada passo.

### Os quatro estados de uma célula de fog

| Valor | Nome | Quem escreve | Some? |
|---|---|---|---|
| 0 | `FOG_NONE` — nunca visto | servidor | — |
| 1 | `FOG_SEEN` — explorado, escuro | servidor (via `fog:discover`) | não |
| 2 | `FOG_VIS` — visível **agora** | cliente, a cada passo | sim |
| 3 | `FOG_REVEAL` — revelado pelo mestre | servidor (via `map:fog`) | não |

O valor 3 existe porque "revelar" e "explorar" são coisas diferentes na mesa: o mestre revela uma
sala **de propósito** e ela não pode escurecer quando o token sai de perto. Sem essa distinção, a
ferramenta de revelar do mestre se desfazia sozinha no primeiro passo de qualquer token.

### Por que walls e fog são `boolean[][]` / `number[][]`

É o formato natural para o render (loop célula a célula) e para a mesma função `hasLOS` que já
existia. **No estado atual eles viajam como JSON puro, sem compressão** — o snapshot inteiro dá
poucos KB e a escala é uma sala de mesa. Comprimir (bitset + RLE no adapter `net/`) fica anotado no
ROADMAP como otimização, não como pendência: medir antes de otimizar.

---

## Persistência (o que sobrevive)

A cena continua vivendo em **memória** — é ela que manda, e é dela que sai cada broadcast. O banco
é a **cópia durável**, e é escrito com **debounce** (alguns segundos depois da última mudança, mais
um flush quando o último jogador sai). Gravar a cada evento seria amplificação de escrita por nada,
porque cada mudança já transmite a cena inteira para todos.

```
jogador entra ─▶ sala existe em memória?
                   não ─▶ carrega a cena do banco (uma vez) ─▶ memória
                   sim ─▶ usa a de memória
mudança ─▶ bump() ─▶ broadcast ─▶ agenda gravação (debounce)
último jogador sai ─▶ grava agora ─▶ sala sai da memória
```

O que **não** é persistido, de propósito:

| Campo | Por quê |
|---|---|
| `version` | Contador de sessão. Uma cena restaurada volta em `0` |
| `ownerId` do ator | É um **socket** — não sobrevive a um restart. Gravar seria gravar lixo |
| `path` do ator | É predição do cliente; no servidor está sempre vazio |
| Token de jogador | Pertence à sessão. Volta a existir quando o jogador entra de novo (`pcActors` em `room.ts`) |

O `data` da coluna `scene` é o **único** lugar do servidor onde entra dado que não passou pela
validação de mensagem: pode ser uma linha antiga, de outro formato, ou editada à mão. Por isso tudo
é coagido, cortado e limitado na volta (`sceneFromPersisted`), e uma linha ilegível é descartada em
vez de derrubar a sala. Há `schemaVersion` dentro do JSON — as regras do jogo ainda vão mudar, e
coluna rígida brigaria com o autor.

**O banco nunca decide o jogo.** Se ele estiver fora, o servidor sobe, avisa no log e a mesa funciona
em memória. Perder a partida por causa do banco seria pior do que não ter banco.

---

## Contas e sessão (ADR #16, entrega 2)

O login passa por **HTTP**, não pelo socket. Três rotas, e só:

| Rota | O que faz |
|---|---|
| `POST /auth/login` | `{ name, password }` → confere o `scrypt` e devolve o cookie de sessão |
| `POST /auth/logout` | Apaga o cookie no cliente |
| `GET /auth/me` | `{ ok, account }` — quem este navegador é, se alguém for |

O jogo continua inteiro no Socket.IO. A divisão é deliberada: tempo real e CRUD são módulos
separados, para trocar um sem encostar no outro (`server/src/http.ts`).

**A parte que faz tudo caber:** o Socket.IO manda os cookies da mesma origem **no handshake**. Então
a identidade chega junto com a conexão — não existe mensagem para "autenticar", e por isso não há
como esquecer de autenticar um evento novo:

```
POST /auth/login ─▶ cookie assinado (HMAC-SHA256, HttpOnly, SameSite=Lax, Secure)
                          │
                          ▼
navegador abre o socket ─▶ handshake leva o cookie ─▶ servidor sabe QUEM é, antes de qualquer evento
                          │
                          ▼
room:join ─▶ nome vem da conta; papel vem do vínculo com a campanha
```

O cookie é **stateless**: carrega `{accountId, name, iat, exp}` e a assinatura. Sem tabela de
sessões no banco. O preço está anotado: **não existe revogação** — sair só faz o navegador esquecer o
cookie, e um cookie copiado continua válido até expirar (30 dias). Trocar `SESSION_SECRET` derruba
todas as sessões de uma vez, o que é o botão de pânico suficiente por agora.

Sem `SESSION_SECRET` configurado, o login fica **desligado** e o servidor avisa no log: só convidado
entra. É melhor isso do que assinar sessão com uma chave inventada.

### Duas formas de ser mestre (durante a migração)

| Caminho | Como | Situação |
|---|---|---|
| **Conta dona da campanha** | Login. `campaign.gm_account_id` bate com a conta da sessão | O caminho novo — **sem senha nenhuma** |
| `GM_KEY` | Senha compartilhada digitada no lobby | Bootstrap. Sai na entrega 4, quando o vínculo virar papel |

Recusar em vez de rebaixar em silêncio é de propósito: quem digitou a senha errada precisa entender
por que não manda no mapa. O `ack` diz qual dos dois caminhos falhou — "senha incorreta" para quem
está logado mandaria procurar o problema no lugar errado.

**Convidado continua convidado:** sem conta, o nome é digitado (até 24 caracteres) e a identidade é o
id do socket, como sempre foi. A conta é um upgrade, não um pedágio — o grupo entra sem cadastro.

### Detalhes que doem se errados

- **A resposta não entrega quais nomes existem.** Login com usuário inexistente confere um hash
  descartável antes de recusar, para gastar o mesmo tempo de um `scrypt` de verdade. Sem isso, o
  relógio diria "esse usuário existe" e o ataque de força bruta começaria pela lista de nomes certos.
- **O limite de tentativas é global, não por IP.** Atrás do túnel e do Docker, todo mundo chega com o
  mesmo IP de origem; um limite por IP seria um limite compartilhado, e o primeiro a abusar travaria o
  grupo inteiro. O teto global serve para o que importa: `scrypt` é caro de propósito, e o mesmo
  processo serve a partida.
- **`Secure` não vem do `X-Forwarded-Proto`.** O Caddy termina o TLS e repassa HTTP puro, então esse
  cabeçalho diz `http` mesmo numa visita HTTPS. Quem sabe a verdade é a borda da Cloudflare, que marca
  a requisição; o acesso direto na LAN não tem marca e continua funcionando sem `Secure`.
- **O `/auth/*` precisa de rota no Caddy.** Sem ela, `POST /auth/login` cai no `try_files` da SPA e
  devolve o `index.html` com status 200 — um erro que parece sucesso.

---

## Fluxo de uma ação (ex.: mover)

```
GM libera permissão        Jogador clica na célula
        │                          │
        ▼                          ▼
  perm:set  ──▶  SERVIDOR  ◀──  actor:intent-move { actorId, row, col }
                      │
                      │  1. a sala existe?          5. é ortogonal e 1 casa?
                      │  2. o ator existe?          6. destino dentro do grid?
                      │  3. o ator é do jogador     7. destino não é parede?
                      │     OU role === "gm"?
                      │  4. canMoveGlobal || canMove?(permissão)
                      │
                 validação falhou ──▶  error { code, msg }
                      │
                 passou: aplica, version++, broadcast
                      ▼
        room:state { scene, players, you, version }  ──▶  todos na sala
```

---

## Como o movimento acontece (predição e correção)

O cliente **anda antes de pedir licença** — mas só na tela dele. Ele avança a posição local
(predição) e manda `actor:intent-move`; o servidor valida e responde com o estado autoritativo.
Se negou, o cliente recebe `error { code: "MOVE_DENIED", actorId }`, **cancela o caminho** e volta o
token para a última posição que o servidor confirmou. Sem isso o token ficava travado na tela:
o usuário veria o boneco "atravessando" uma parede que o servidor recusou.

Duas regras fazem isso funcionar:

1. **`path` é só do cliente.** O servidor não conhece fila de passos. Ao aplicar `room:state`, o
   cliente preserva o `path` local do ator — se aplicasse o ator do servidor inteiro, o token
   pararia no meio do caminho a cada pacote.
2. **A posição confirmada fica guardada** (`confirmed`, no adapter). É para onde o token volta
   quando um passo é negado.

Regras de validação (o servidor roda isto de verdade; é a mesma função pura que o cliente usa para
saber se pode andar):

```ts
function canMove(room: Room, player: Player, actorId: string, to: Cell): Verdict
// 1. o ator existe?                      5. o destino está dentro do grid?
// 2. o ator é do jogador, ou ele é GM?   6. o destino não é parede?
// 3. canMoveGlobal || actor.canMove?     7. o destino é ortogonal e a 1 casa?
```

A checagem 7 ("um passo por vez") é o que permite ao servidor validar sem refazer pathfinding: o
cliente manda um passo, não um destino final.

---

## Contrato de mensagens (o que existe hoje)

Cliente → Servidor

| Evento | Payload | Quem pode |
|---|---|---|
| `room:join` | `{ code, name, role, key }` + ack | todos — `role: "gm"` exige a conta dona da campanha **ou** `key` |
| `actor:intent-move` | `{ actorId, row, col }` | dono do ator ou GM |
| `fog:discover` | `{ cells: [{row, col}] }` | todos — o servidor só aceita célula que algum ator enxerga |
| `map:walls` | `{ op: "set" \| "clear", cells }` | GM |
| `map:fog` | `{ op: "reveal" \| "hide", cells }` | GM |
| `map:config` | `{ cols?, rows?, cell?, bgImage?, fogMode? }` | GM |
| `actor:add` | `{ actor }` | GM |
| `actor:update` | `{ id, patch }` | GM — ou o dono, só `portrait`/`name`/`color` |
| `actor:remove` | `{ id }` | GM |
| `sector:add` / `sector:remove` | `{ name, r1, c1, r2, c2 }` / `{ id }` | GM |
| `perm:set` | `{ playerId?, canMoveGlobal?, actorId?, canMove? }` | GM |
| `player:assign` | `{ playerId, actorId }` | GM |

Servidor → Cliente

| Evento | Payload |
|---|---|
| `room:state` | `{ code, you, scene, players }` — snapshot completo |
| `error` | `{ code, msg, actorId? }` |

### Snapshot vs. delta

`room:patch` (deltas) foi **deixado de lado de propósito** nesta fase. O snapshot inteiro da cena
cabe em poucos KB de JSON, e uma mesa tem 4–6 pessoas mandando um passo de cada vez. Broadcast
completo é menos código, menos estado divergente e mais fácil de depurar. Se um dia incomodar, o
delta entra **atrás do mesmo adapter** — o resto do sistema não muda.

### O ack de `room:join`

`room:join` recebe um ack com o estado inicial. O broadcast `room:state` chega **depois** do ack,
então quem entra usa o ack como primeiro estado; sem isso a tela fica vazia por um instante.

O ack também é o canal de recusa: `{ ok: false, error }`. Hoje só um motivo usa isso — entrar como
mestre sem ser a conta dona da campanha e com `key` errada — e o cliente volta para o lobby mostrando
o motivo, em vez de ficar conectado sem estar na sala. A recusa também **descarta a sala** se ela
tiver ficado vazia: a sala foi carregada só para decidir o papel, e sem isso ela ficaria para sempre
em memória, vazia e invisível.

As rotas HTTP de autenticação são o segundo caminho de entrada, e estão em "Contas e sessão".

### Quem é mestre

Duas formas convivem até a entrega 4 (ver "Contas e sessão"): **login com a conta dona da campanha**
(o caminho novo, sem senha nenhuma) ou **`GM_KEY`**, a senha única compartilhada (o bootstrap).

Sem `GM_KEY` definida e sem conta, qualquer um vira mestre — o que só é aceitável em rede local: o
servidor avisa no log ao subir, e `deploy/check-publico.ps1` avisa de novo se as portas estiverem
abertas para a internet.

O papel é decidido **uma vez, na entrada**, e vale para a conexão inteira. Não existe promover ou
rebaixar alguém com a mesa aberta: a identidade não muda no meio de uma partida, e um evento novo só
precisa consultar o que já foi decidido. Ver `DECISOES.md` #12 e #16.

### O adapter de rede

Fica em `client/src/net/`, em dois arquivos:

| Arquivo | Papel |
|---|---|
| `bridge.ts` | `send()` / `isOnline()` — o que o store chama, sem saber que existe socket |
| `socket.ts` | implementação Socket.IO: conectar, entrar, aplicar `room:state`, desfazer predição negada |

O `bridge` existe por um motivo chato e real: o store precisa mandar intenção e o adapter precisa
escrever no store. Sem ele, os dois módulos se importariam mutuamente (dependência circular). Com
ele, o store depende de uma interface minúscula e o adapter é quem tem o socket. Trocar Socket.IO
por Colyseus é reescrever `socket.ts`; `bridge.ts` e todo o resto continuam iguais.

**Modo local:** se ninguém conectou, `isOnline()` é falso e as ações do store aplicam direto no
estado — o app funciona igual às Fases 0/1, o que deixa o mestre preparar o mapa sozinho antes de
abrir a sala.

---

## Visão (fog of war) por jogador

**Estado hoje (Fase 2):** o servidor já guarda `fogExplored` (o que a mesa já viu, compartilhado) e
o cliente já reporta o que descobriu (`fog:discover`). O que **ainda não** está separado é a visão
*atual*: `computeVision` continua rodando com todos os atores que o cliente recebe. Numa mesa de
amigos isso é aceitável — o corte por jogador é a Fase 3, e está descrito abaixo.

O protótipo original fazia `computeVision` com **todos** os tokens — isso vaza a visão dos outros.
Em multiplayer a visão se divide em duas:

| Conceito | Escopo | Onde vive | Persistente? |
|---|---|---|---|
| `fogExplored` | sala (todos veem o mesmo já-explorado) | servidor | sim |
| `visibleNow` | ** por jogador** (raio do token dele) | cliente (Fase 3) | não |

Render do fog para um jogador = união: `explored` (escuro, 62% de opacidade) + `visibleNow` (nítido).

**Fase 1/3 inicial — confiança no grupo:** o servidor guarda `fogExplored`; o cliente calcula
`visibleNow` localmente com o próprio token e envia ao servidor as células novas descobertas
(`fog:discover`). Mas **o cliente não decide o que foi revelado**: o servidor recalcula a visão de
todos os atores com `visibleCellsFrom` (a mesma função que o cliente usa) e descarta qualquer célula
fora dela. Sem essa checagem, um jogador mandava o tabuleiro inteiro numa mensagem e apagava o fog
de guerra de todo mundo. Ver `DECISOES.md` #15.

**Anti-cheat completo (depois):** o servidor calcula `visibleNow` **por jogador** e manda só o
resultado pro cliente — aí o jogador nunca recebe o mapa inteiro. Custa CPU (raycast de ~660 células
por token a cada passo), mas é barato na escala real. Documentado em `ROADMAP.md` Fase 3.

O GM ignora tudo isso: `gmMode` mostra o mapa inteiro.

---

## Transporte de rede

**Socket.IO**, com um servidor autoritativo em `server/`. O contrato está acima, em
"Contrato de mensagens". Em produção quem defende o WebSocket é o Caddy: `handle /socket.io/*` faz
`reverse_proxy app:3000`, e o serviço `app` **não** publica porta no host.

---

## Desenho e interpolação

O render já roda a 60fps (`requestAnimationFrame`) no protótipo — isso se mantém.

Cada ator tem **duas posições**:

- **lógica** (`actor.row/col`, inteiro) — autoritativa, vem do servidor;
- **renderizada** (`rx, ry`, float em unidades de célula) — local, animada.

A cada frame o render aproxima `rx/ry` de `row/col` a velocidade constante. Quando a posição
lógica muda (chegou o pacote), o sprite **anda** até lá em vez de saltar. `facing` vem da direção
do movimento; `walkFrame` avança enquanto `rx/ry ≠ row/col` e volta ao repouso quando chega.

Pathfinding: `shared/src/pathfinding.ts` faz BFS ortogonal respeitando paredes. O ator segue a fila
de células; a cada célula alcançada, o estado local avança **e** um `actor:intent-move` é enviado ao
servidor, que aceita ou nega o passo.

Sprites: `render/sprites.ts` carrega `/sprites/<key>.png` (4 linhas de direção × N colunas de frames)
e cai num **desenhador procedural** se o arquivo não existir — assim o projeto roda hoje, sem asset,
e ganha arte depois só soltando o PNG na pasta. Se o ator tem `portrait`, é ele que é desenhado
(retrato recortado em círculo, deslizando), o que combina com a arte que o grupo já tem.

---

## Segurança (o mínimo, não negociável)

Feito:

- Nenhuma regra de jogo no cliente é confiada: o servidor tem a palavra final em movimento,
  permissão, edição de mapa e fog.
- `fog:discover` é validado aqui: só célula que **algum ator realmente enxerga** é aceita, e no
  máximo 5000 células por mensagem. O cliente sugere, o servidor decide.
- Limite de taxa por conexão (token bucket: 60 eventos/s, rajada de 150) e payload máximo de 256 KB.
  Pacote acima do limite é descartado em silêncio; abuso contínuo derruba a conexão. Isto dói mais
  que o normal porque **cada evento aceito transmite a cena inteira** para todos.
- Handshake só de **mesma origem**: requisição com `Origin` de outro site leva 403, então uma página
  maliciosa não abre socket aqui a partir do navegador da vítima.
- O serviço `app` não publica porta (só o Caddy fala com o mundo) e **não roda como root**:
  `USER node`, filesystem somente-leitura, `/tmp` em tmpfs, nenhuma capability,
  `no-new-privileges`.
- Caddy na frente: TLS, headers, proxy do WebSocket **e do `/auth/*`**.
- Sala por código, nome limitado a 24 caracteres.
- **Conta e sessão (ADR #16):** senha com `scrypt` (`node:crypto`, sem dependência nova), nunca em
  texto puro nem no log; cookie `HttpOnly` + `SameSite=Lax` + `Secure` quando a visita é HTTPS, e
  assinado com HMAC-SHA256. Resposta de login igual para usuário inexistente e senha errada — inclusive
  no tempo. Limite global de tentativas de login, porque `scrypt` é caro e o mesmo processo serve a
  partida.
- **A identidade chega no handshake**, pelo cookie: não existe evento de "autenticar" que alguém possa
  esquecer de chamar.

Ainda não feito (anotado no ROADMAP):

- **RBAC de verdade:** papéis e permissão por token. Hoje existem **duas** formas de virar mestre — o
  `GM_KEY`, que é segredo compartilhado e portanto não responde "quem é quem", e a conta dona da
  campanha. A segunda já está ligada ao `room:join`; falta o `GM_KEY` sair (entrega 4) e o papel do
  jogador vir do vínculo.
- **Sem revogação de sessão e sem recuperação de senha.** O cookie é stateless: sair só o apaga no
  navegador, e um cookie copiado vale até expirar. Trocar `SESSION_SECRET` derruba todas as sessões.
  Quem esquecer a senha depende do mestre (a senha de mestre é temporária e está avisada no lobby).
- **Jogador entra sem senha.** O `GM_KEY` protege só o papel de mestre. O plano mudou de um `JOIN_KEY`
  separado para o **vínculo com a campanha** (ADR #16): quem controla a entrada é pertencer à mesa,
  não saber uma segunda senha.
- **Qualquer código novo cria uma campanha.** Enquanto não existe tela de criar campanha (entrega 3),
  entrar com um selo desconhecido cria a linha na hora — quem tem a URL cria campanhas sem limite. A
  correção é a própria entrega 3: criar campanha de propósito e recusar selo desconhecido.
- Visão por jogador (`visibleNow`): hoje `fogExplored` é compartilhado e o cliente recebe **todos**
  os atores, então um jogador vê o raio de visão dos outros tokens, não só o do dele.
- `ROOM_CODE` não é segredo: quem tem o endereço e o código entra como jogador. Ser mestre exige a
  senha. Para mesa fechada de verdade, use a Opção C (Tailscale) do Caddyfile.
