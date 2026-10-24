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
client/src/screens/      as páginas (Entrar, Mesa, Shell) — ADR #21
        │  monta
        ▼
client/src/components/   UI React (FogWarMap, PlayersPanel, ...)
        │  lê/escreve via ações
        ▼
client/src/state/        gameStore + netStore + sessionStore (Zustand)
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

## Contas e sessão (ADRs #16, #19 e #20 — entregas 2, 4 e 5)

O login passa por **HTTP**, não pelo socket. Quatro rotas, e só:

| Rota | O que faz |
|---|---|
| `POST /api/auth/login` | `{ name, password }` → confere o `scrypt` e devolve o cookie de sessão |
| `POST /api/accounts` | `{ name, password }` → **cria a conta** e já devolve o cookie (cadastro, ADR #19) |
| `POST /api/auth/logout` | Apaga o cookie no cliente |
| `GET /api/auth/me` | `{ ok, account, signup }` — quem este navegador é, e se o servidor aceita cadastro novo |

Além dessas, o **painel do administrador** (ADR #23): `GET /api/admin/accounts` lista as contas e
`POST /api/admin/accounts/:nome/password` define a senha de uma delas. As duas exigem a conta cujo
nome é `ADMIN_ACCOUNT` (padrão `admin`) — **é nome, não papel**, e o servidor confere em cada
chamada. A página `/admin` é só a tela; esconder o link não é permissão.

O jogo continua inteiro no Socket.IO. A divisão é deliberada: tempo real e CRUD são módulos
separados, para trocar um sem encostar no outro (`server/src/http.ts`).

**Tudo que o servidor responde em HTTP vive sob `/api`, e isso é contrato, não estilo.** O Caddy
manda `/socket.io/*` e `/api/*` para o app e serve o resto como arquivo estático; rota nova dentro do
prefixo não tem como ser esquecida, e rota que falta vira **404 de verdade**. Antes disso, cada rota
precisava ser lembrada no `Caddyfile`, e esquecer uma significava cair no `try_files` da SPA e receber
o `index.html` com **status 200** — um erro que se disfarça de sucesso, e que custou duas sessões de
depuração.

**A parte que faz tudo caber:** o Socket.IO manda os cookies da mesma origem **no handshake**. Então
a identidade chega junto com a conexão — não existe mensagem para "autenticar", e por isso não há
como esquecer de autenticar um evento novo:

```
POST /api/auth/login ─▶ cookie assinado (HMAC-SHA256, HttpOnly, SameSite=Lax, Secure)
                          │
                          ▼
navegador abre o socket ─▶ handshake leva o cookie ─▶ servidor sabe QUEM é, antes de qualquer evento
                          │
                          ▼
room:join ─▶ nome vem da conta; papel vem do vínculo com a missão
             sem sessão válida, recusa — e nada é criado (ADR #20)
```

O cookie é **stateless**: carrega `{accountId, name, iat, exp}` e a assinatura. Sem tabela de
sessões no banco. O preço está anotado: **não existe revogação** — sair só faz o navegador esquecer o
cookie, e um cookie copiado continua válido até expirar (30 dias). Trocar `SESSION_SECRET` derruba
todas as sessões de uma vez, o que é o botão de pânico suficiente por agora.

Sem `SESSION_SECRET` configurado, o login fica **desligado** — e, desde a entrega 5, **ninguém entra na
mesa**: exigir conta com o login desligado é a única regra coerente, e o boot avisa em letras grandes. É
melhor isso do que assinar sessão com uma chave inventada ou abrir a mesa sem conta nenhuma.

### Cadastro: aberto, com freio e interruptor (ADR #19)

Criar conta é `POST /api/accounts`: nome de 2 a 24 caracteres, senha de 6 a 200, e o servidor já
devolve o cookie — quem se cadastra entra, sem tela de "agora digite de novo o que você acabou de
digitar".

**O cadastro é aberto por padrão.** `REGISTRATION=closed` fecha a porta (a página de entrada para de oferecer
"criar conta", o servidor responde 403 e o boot avisa), e `REGISTER_PER_MINUTE` (padrão 10) limita a
rajada. O freio é modesto porque o que um cadastro entrega a um estranho é pouco: **entrar ainda exige
o Selo da Missão, e ser mestre ainda exige vínculo**. A conta sozinha não abre mesa nenhuma — o limite
existe para não entupir o `scrypt`, que é caro de propósito e roda na mesma thread da partida.

`GET /api/auth/me` devolve `signup` junto de "quem sou eu": a página de entrada precisa saber se pode oferecer o
formulário antes de a pessoa preencher.

**Nome repetido é dito na cara aqui — no login, não.** É a única assimetria, e é inevitável: o índice
`unique` recusaria de qualquer jeito, e uma mensagem genérica só faria a pessoa tentar de novo à toa.
No login a resposta continua cega, porque ali não custa nada ser cego (e evita a enumeração de nomes).

### Quem é mestre: o vínculo, não a posse (ADR #19)

| Caminho | Como | Situação |
|---|---|---|
| **Vínculo de mestre** | `membership.role = 'gm'` para aquela missão | O caminho de verdade — **sem senha nenhuma** |
| `GM_KEY` | Senha compartilhada digitada em *opções avançadas*, na página da missão | **Legado**, mantido por não existir recuperação de senha; **não escreve vínculo** |

`campaign.gm_account_id` continua existindo, mas virou o **dono**: quem administra (apaga a missão,
aparece como dono na lista). Quem criou a missão recebe um vínculo `gm` **na mesma instrução** que a
cria — um CTE que escreve, e no Postgres ele roda inteiro ou não roda. Se as duas coisas pudessem se
separar, o dono ficaria sem o papel de mestre na própria missão, em silêncio.

**Estar na mesa é ser agente dela; ser mestre é outorga explícita.** Entrar grava vínculo de jogador, e
o conflito não rebaixa ninguém. Quem é mestre **entra como mestre**: o cliente não pede papel (ADR #20), e
o único jeito de deixar de ser mestre é alguém com poder rebaixar — o que também vale na hora (ADR #22).

Recusar em vez de rebaixar em silêncio é de propósito: quem digitou a senha errada precisa entender por
que não manda no mapa. Desde a entrega 5 a recusa é uma só — **"Senha de mestre incorreta."** — porque a
chave só pode significar uma coisa: "quero entrar como mestre". Quem tem vínculo ignora a chave errada.

**Não existe mais convidado (ADR #20).** Sem conta não se entra: o nome vem da conta, o papel vem do
vínculo e o cadastro é a porta. A conta deixou de ser um upgrade e virou pedágio consciente — é o preço
do nome estável, de ser encontrado na lista de membros e de poder ser promovido.

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

---

## Selo da Missão (ADR #18, entrega 3)

O selo é o **convite do agente**: quem tem conta entra por ele, então ele é a única coisa entre um
estranho que achou a URL e a sua mesa. Por isso ele é **gerado**, legível e não escolhido:

```
CORVO-AMBAR-VEU-74      três palavras (de 165, sem acento) + dois dígitos ≈ 28 bits
```

Palavras curtas e distintas, ditáveis em voz alta no Discord, e nenhuma que soe como outra (`LENTE`
ficou, `LENTO` não). A lista é validada ao carregar o servidor: palavra repetida, comprida ou fora de
A-Z derruba o boot com a mensagem na cara, em vez de virar um selo esquisito meses depois.

A campanha passou a ser criada **de propósito**, e não de carona:

| Rota | Quem pode | O que faz |
|---|---|---|
| `POST /api/campaigns` | conta | Cria a missão (nome + selo sorteado), torna a conta **dona** e **mestra** |
| `GET /api/campaigns` | conta | **Minhas mesas**: as que criei e as que entrei, com o papel de cada uma |
| `POST /api/campaigns/:selo/role` | mestre da missão | Dá ou tira o papel de mestre de uma conta (ADR #22) |
| `DELETE /api/campaigns/:selo` | dona | Apaga a missão, a cena e os vínculos junto |

Antes, entrar com um selo novo criava a linha na hora: qualquer um com a URL criava campanha sem
limite — e a tabela encheu de `SMOKE-*` e `AUTH-*` só de rodar teste. Agora **selo desconhecido não
entra e não cria nada**, nem sala em memória. Os testes também mudaram de comportamento: criam a
missão de que precisam e **apagam no fim**.

### O que decide se um selo entra

```
room:join ─▶ normaliza (maiúsculas, sem acento)
                 │
                 ▼
        pergunta ao banco ─┬─ existe ─────────────▶ entra
                           ├─ não existe ─────────▶ recusa, sem criar nada
                           └─ banco não respondeu ▶ entra em memória (ADR #17)
```

A terceira linha é a que impede o banco de derrubar a mesa: **sem banco não existe veredito**, e
recusar todo mundo transformaria "banco caiu" em "mesa não abre". Por isso a consulta distingue
"não existe" de "não deu para saber" (`CampaignLookup`), em vez de devolver `null` para os dois.

Errar o selo tem preço: a conexão guarda um contador e é derrubada ao passar de 20 tentativas. Adivinhar
um selo é a única porta que depende de palpite, e sem contador uma conexão varre selos na velocidade do
limite de pacotes.

### Onde o selo mora na tela (ADR #21)

| Momento | O que aparece |
|---|---|
| `/mesa`, com conta | Lista **Missões de \<conta\>**, com **mestre** ou **agente** em cada uma — clicar preenche o selo; o `×`, que só o dono vê, apaga com confirmação |
| Recém-criada | O selo é destacado e já cai no campo: é o que o mestre dita para o grupo |
| Agente | Digita o selo uma vez; fica guardado no navegador para a próxima |
| Sem conta | Não passa de `/entrar`: a mesa não é uma tela pública |
| Na mesa | O cabeçalho mostra o **nome** da missão; o selo continua à mão do mestre |

O nome (\"A Maldição de Veríssimo\") é para ler; o selo é para entrar. **Os dois não se derivam**:
batizar a missão não pode determinar o convite. E o `ROOM_CODE` do deploy virou o **selo sugerido**,
criado no boot **apenas quando o banco está vazio**.

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
| `room:join` | `{ code, name, role, key }` + ack | todos — `code` precisa ser um **selo existente**; `role: "gm"` exige **vínculo de mestre** com a missão **ou** `key` |
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

O ack também é o canal de recusa: `{ ok: false, error }`. **Três** motivos usam isso hoje — **sem conta**
(ADR #20), o **selo desconhecido** (ADR #18) e **chave de mestre errada** por quem não tem vínculo. Nos
três casos o cliente volta à página da missão mostrando o motivo, em vez de ficar conectado sem estar na
sala. A recusa de chave também **descarta a sala** se ela tiver ficado vazia: a sala foi carregada só para
decidir o papel, e sem isso ela ficaria para sempre em memória, vazia e invisível. A recusa de conta acontece
antes de qualquer consulta, e a de selo nem chega a criar sala.

As rotas HTTP (`/api/auth/*` e `/api/campaigns`) são o outro caminho de entrada, e estão em "Contas e
sessão" e em "Selo da Missão".

### Quem é mestre

Quem decide é o **vínculo com a missão**: `membership.role = 'gm'`. Quem cria a missão recebe esse
vínculo (e é também o **dono**, que é quem apaga). O `GM_KEY` continua valendo como escapatória — é
legado, e sai quando existir recuperação de senha (ver "Quem é mestre: o vínculo, não a posse").

**Sem `GM_KEY` definida, não existe escapatória.** Até a entrega 4, chave vazia significava "sem senha —
qualquer um é mestre", o que só era aceitável em rede local sem contas. Com conta obrigatória isso seria
entregar a mesa a qualquer conta que digitasse qualquer coisa: agora vazio = nenhum caminho além do
vínculo.

O papel é decidido **na entrada** — e muda **de propósito** com a mesa aberta, por um caminho só: a rota
de papel (ADR #22). Ela grava o vínculo e avisa a mesa viva por `server/src/live.ts`; o servidor atualiza
`room.players` e reenvia o snapshot, e a pessoa promovida comanda o mapa sem F5. Fora desse caminho, a
identidade não muda no meio de uma partida.

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
- Caddy na frente: TLS, headers, proxy do WebSocket **e de todo `/api/*`**.
- Sala por **selo**, nome limitado a 24 caracteres. O selo é sorteado pelo servidor (três palavras +
  dois dígitos, ~28 bits) e **selo desconhecido não entra** — não cria linha nem sala. Errar o selo
  mais de 20 vezes na mesma conexão derruba a conexão: adivinhar é a única porta que depende de palpite.
- **Conta e sessão (ADR #16):** senha com `scrypt` (`node:crypto`, sem dependência nova), nunca em
  texto puro nem no log; cookie `HttpOnly` + `SameSite=Lax` + `Secure` quando a visita é HTTPS, e
  assinado com HMAC-SHA256. Resposta de login igual para usuário inexistente e senha errada — inclusive
  no tempo. Limite global de tentativas de login, porque `scrypt` é caro e o mesmo processo serve a
  partida.
- **Cadastro de conta (ADR #19):** `POST /api/accounts` cria a conta e já devolve a sessão. Aberto por
  padrão, com teto global (`REGISTER_PER_MINUTE`) e interruptor (`REGISTRATION=closed`, que também faz
  a página de entrada parar de oferecer o formulário). O que um cadastro entrega a um estranho é pouco:
  entrar ainda exige o selo, e mestre ainda exige vínculo. **Desde a entrega 5, fechar o cadastro fecha a
  porta de entrada de gente nova**: sem conta não se entra, e não há como criar uma.
- **Painel do administrador (ADR #23):** uma conta, escolhida pelo **nome** (`ADMIN_ACCOUNT`, padrão
  `admin`), lista as contas e troca a senha de qualquer uma em `/admin`. É o substituto da recuperação
  de senha que não existe, e não é um papel: não entra no modelo de vínculo, não dá poder na mesa e
  não muda o papel de ninguém. A senha nova **não derruba sessões abertas** — para isso, troque
  `SESSION_SECRET`.
- **A identidade chega no handshake**, pelo cookie: não existe evento de "autenticar" que alguém possa
  esquecer de chamar. **E ela é obrigatória**: sem sessão válida, `room:join` recusa (ADR #20).
- **Criar e apagar missão exigem conta** (ADR #18): quem cria é o dono, e apagar é do dono. Quem não é
  dono recebe 404 e não descobre nem quais selos existem. O papel de **mestre na mesa** vem do
  **vínculo** (`membership.role`), não da posse (ADR #19), e pode ser **outorgado** por quem já é mestre
  — na hora, sem F5 (ADR #22). O dono nunca é rebaixado.

Ainda não feito (anotado no ROADMAP):

- **RBAC de verdade:** papéis e permissão por token. O papel do jogador **já vem do vínculo**
  (`membership.role`), o mestre **já outorga** o papel (ADR #22), e o `GM_KEY` virou legado explícito. Ele
  só sai quando existirem recuperação de senha **self-service** e revogação de sessão — o administrador
  já troca senha em `/admin` (ADR #23), mas isso ainda é alguém abrindo a porta por você. Antes disso,
  tirá-lo trancaria o grupo de fora se o mestre esquecesse a senha. Falta: ler o vínculo para além de
  mestre/jogador (permissão por token, por exemplo).
- **Sem revogação de sessão, e a senha só o administrador troca.** O cookie é stateless: sair só o apaga
  no navegador, e um cookie copiado vale até expirar. Trocar `SESSION_SECRET` derruba todas as sessões.
  **Não existe "esqueci minha senha" automático:** quem esquece pede ao administrador, que define uma
  nova em `/admin` (ADR #23). A troca resolve o login seguinte, não o presente — a sessão antiga
  continua valendo até expirar.
- **Jogador entra sem senha.** O `GM_KEY` protege só o papel de mestre. O plano mudou de um `JOIN_KEY`
  separado para o **vínculo com a campanha** (ADR #16): quem controla a entrada é pertencer à mesa,
  não saber uma segunda senha. Hoje o vínculo é **gravado na entrada**, não exigido para entrar: com o
  selo, já se entra e já se vira membro — e quem foi promovido continua membro.
- **Apagar a própria conta não existe**, e mexeria em campanha órfã: a campanha pertence ao dono, e o
  dono pode querer ir embora. Enquanto isso, o teste de vínculo limpa a conta de teste pelo banco (ver
  `server/scripts/harness.mjs`) — é o único ponto da suíte que fala com o banco em vez de falar HTTP.
- **Missão não tem renomear.** O nome é escolhido na criação e o `PATCH` ainda não existe: quem
  errou o nome cria outra missão. Barato de resolver, e não interfere em nada.
- **Visão por jogador (`visibleNow`):** hoje `fogExplored` é compartilhado e o cliente recebe **todos**
  os atores, então um jogador vê o raio de visão dos outros tokens, não só o do dele.
- **O selo é o convite, e convite vaza.** Quem tem o endereço e o selo entra como jogador; o selo não
  é segredo forte, é difícil de adivinhar. Ser mestre exige **vínculo com a missão** (ou a senha de
  mestre, que é legado). Para mesa fechada de verdade, use a Opção C (Tailscale) do Caddyfile.
