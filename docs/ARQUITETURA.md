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
components/     UI React (FogWarMap, sidebar, minimap) — "burra", só desenha e captura evento
    │  lê/escreve via ações
    ▼
state/          gameStore (Zustand) — fonte da verdade NO CLIENTE
    │  chama funções puras
    ▼
game/           lógica pura, sem React, sem rede, sem canvas
                grade, visão (LOS), pathfinding, colisão
    ▲
    │  mesmo módulo será usado no servidor
server/         (Fase 2) importa game/ e roda as MESMAS regras
```

**Regra de ouro:** `game/` não importa React, não importa canvas, não importa socket. É função pura
de `(estado, entrada) → saída`. Isso permite:

1. testar sem browser;
2. rodar **exatamente as mesmas** regras no servidor (validação) e no cliente (predição/desenho);
3. trocar transporte de rede sem tocar no jogo.

`render/` fica separado porque desenhar no canvas é efeito colateral: nada de lógica de jogo ali.

---

## Modelo de estado

```ts
type Role = "gm" | "player";
type Facing = "n" | "s" | "e" | "w";

interface Actor {          // token jogável (jogador, NPC, monstro)
  id: string;
  name: string;
  ownerId: string | null;  // null = NPC controlado pelo GM
  row: number;             // célula lógica confirmada
  col: number;
  facing: Facing;
  vision: number;          // raio de visão em células
  sprite: string;          // chave do spritesheet
  color: string;
  canMove: boolean;        // permissão individual
}

interface Sector { id: string; name: string; r1: number; c1: number; r2: number; c2: number; color: string; }

interface Scene {
  cols: number; rows: number; cell: number;   // dimensões e tamanho da célula em px
  bgImage: string | null;                     // URL ou data URL
  walls: boolean[][];                         // obstáculo e bloqueio de LOS
  fogExplored: number[][];                    // COMPARTILHADO e permanente (0/1)
  actors: Actor[];
  sectors: Sector[];
  fogMode: "soft" | "hard";
  version: number;                            // incrementa a cada mudança autoritativa
}

interface Player {
  id: string; name: string; role: Role;
  actorId: string | null;      // qual ator ele controla
  canMoveGlobal: boolean;      // liberação geral do GM
  connected: boolean;
}

interface Room { code: string; scene: Scene; players: Record<string, Player>; }
```

### Por que walls e fog são `boolean[][]` / `number[][]` no cliente

É o formato natural para o render (loop célula a célula) e para a mesma função `hasLOS` que já
existia. **Na rede** eles viajam comprimidos (bitset achatado + RLE); a conversão acontece só no
adapter `net/`. Assim o jogo não precisa saber de compressão.

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
        room:patch { actors: [...], version }  ──▶  todos na sala
```

O cliente **nunca** altera `actor.row/col` por conta própria ao clicar; ele enfileira o passo e
espera confirmação. Enquanto espera, usa o path local como *predição* (por isso a interpolação:
nada de teleporte quando o pacote chega).

Regras de validação (mesma função usada no cliente para habilitar/desabilitar a UI):

```ts
function canMoveActor(state: Scene, players, playerId, actorId, to: Cell): { ok: boolean; reason?: string }
```

---

## Visão (fog of war) por jogador

O protótipo atual faz `computeVision` com **todos** os tokens — isso vaza a visão dos outros. Em
multiplayer a visão se divide em duas:

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

**Socket.IO** (ver `DECISOES.md` #1).

### Contrato de mensagens

Cliente → Servidor

| Evento | Payload | Quem pode |
|---|---|---|
| `room:join` | `{ code, name, role? }` | todos |
| `room:leave` | `{}` | todos |
| `actor:intent-move` | `{ actorId, row, col }` | dono do ator ou GM |
| `fog:discover` | `{ cells: [r,c][] }` | todos |
| `actor:add` / `actor:update` / `actor:remove` | `{ actor }` / `{ id, patch }` / `{ id }` | GM |
| `map:walls` | `{ op: "set" \| "clear", cells: [r,c][] }` | GM |
| `map:fog` | `{ op: "reveal" \| "hide", cells: [r,c][] }` | GM |
| `map:config` | `{ cols?, rows?, cell?, bgImage?, fogMode? }` | GM |
| `perm:set` | `{ playerId, canMoveGlobal?, canMove?: { actorId, value } }` | GM |
| `ping` | `{ t }` | todos |

Servidor → Cliente

| Evento | Payload |
|---|---|
| `room:state` | snapshot completo (entrada/reconexão) |
| `room:patch` | deltas desde a última `version` |
| `room:players` | lista de jogadores atualizada |
| `fog:merge` | células que o servidor aceitou como novas |
| `error` | `{ code, msg }` |

O adapter fica em `client/src/net/` com uma interface fixa:

```ts
interface NetAdapter {
  connect(url: string): Promise<void>;
  join(code: string, name: string): Promise<Room>;
  send<T>(event: string, payload: T): void;
  on(event: string, handler: (payload: any) => void): () => void;
  disconnect(): void;
}
```

Se um dia migrar pra Colyseus, é só outra implementação dessa interface.

---

## Desenho e interpolação

O render já roda a 60fps (`requestAnimationFrame`) no protótipo — isso se mantém.

Cada ator tem **duas posições**:

- **lógica** (`actor.row/col`, inteiro) — autoritativa, vem do servidor;
- **renderizada** (`rx, ry`, float em unidades de célula) — local, animada.

A cada frame o render aproxima `rx/ry` de `row/col` a velocidade constante. Quando a posição
lógica muda (chegou o pacote), o sprite **anda** até lá em vez de saltar. `facing` vem da direção
do movimento; `walkFrame` avança enquanto `rx/ry ≠ row/col` e volta ao repouso quando chega.

Pathfinding: `game/pathfinding.ts` faz BFS ortogonal respeitando paredes. O ator segue a fila de
células; em cada célula alcançada, o estado lógico avança (e, na Fase 2, um `intent-move` é
enviado ao servidor).

Sprites: `render/sprites.ts` carrega `/sprites/<key>.png` (4 linhas de direção × N colunas de frames)
e cai num **desenhador procedural** se o arquivo não existir — assim o projeto roda hoje, sem asset,
e ganha arte depois só soltando o PNG na pasta.

---

## Segurança (o mínimo, não negociável)

- Nenhuma regra de jogo no cliente é confiada: o servidor revalida tudo.
- `room:join` com código de sala + nome; gerar token de sessão na entrada.
- Rate limit por socket (movimentos/segundo) — evita spam de pacote e de raycast.
- Caddy na frente: TLS, headers, limite de corpo.
- Nunca expor a API do Docker. Só 80/443 (ou a porta do túnel) saem pra fora.
