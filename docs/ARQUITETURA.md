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
| `room:join` | `{ code, name, role? }` + ack | todos |
| `actor:intent-move` | `{ actorId, row, col }` | dono do ator ou GM |
| `fog:discover` | `{ cells: [{row, col}] }` | todos |
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
(`fog:discover`). Simples e suficiente.

**Anti-cheat (opcional, depois):** o servidor calcula `visibleNow` e manda só o resultado pro
cliente — o jogador nunca recebe o mapa inteiro. Custa CPU (raycast de ~660 células por token a
cada passo), mas é barato na escala real. Documentado em `ROADMAP.md` Fase 3.

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
- O serviço `app` não publica porta: só o Caddy fala com o mundo.
- Caddy na frente: TLS, headers, proxy do WebSocket.
- `origin` configurável (CORS), sala por código, nome limitado a 24 caracteres.

Ainda não feito (anotado no ROADMAP):

- Token de sessão assinado no `room:join` — hoje a identidade é o id do socket.
- Rate limit por socket (passos/segundo).
- `ROOM_CODE` não é segredo: quem tem o IP e o código entra. Para mesa fechada, use a Opção C
  (Tailscale) do Caddyfile ou troque o código.
