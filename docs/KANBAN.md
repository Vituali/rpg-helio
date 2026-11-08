# Kanban

O `ROADMAP.md` diz **o que** entra em cada fase e quando uma fase está pronta. Este arquivo diz
**o que está sendo feito agora, por quem, e o que está travado** — inclusive quando a resposta é
"travado por outro trabalho em andamento".

---

## Regra de convivência (leia primeiro)

Duas frentes mexem neste repositório ao mesmo tempo. Sem fronteira explícita, o conflito é
silencioso e caro.

| Frente | Pode mexer em |
|---|---|
| **Núcleo** (servidor, regras, infra) | `server/`, `shared/`, `deploy/`, `docs/` |
| **UI** | `client/` |

O contrato entre as duas é o pacote `@helio/shared` + a tabela de mensagens de `ARQUITETURA.md`.
**Mudar qualquer um dos dois exige um ADR** em `DECISOES.md`. Não é burocracia: é o que impede as
duas frentes divergirem sem ninguém perceber.

**WIP = 1** para mudança grande em `client/`. A refatoração de UI terminou (commit `d701ac3`), então a
Fase 3 está liberada — mas continue um item por vez: as duas frentes mexem no `gameStore`, e a segunda
a mexer vai perder.

---

## Em andamento (WIP = 1)

🔵 **Slice "a sessão que sobrevive"** — persistência + conta + identidade (ADRs #16 a #22). É um
assunto só: sem identidade, "salvar" não tem dono. Seis entregas, cada uma utilizável sozinha.

| # | Entrega | Estado |
|---|---|---|
| 1 | Postgres + migrations + cena que sobrevive ao restart | ✅ (commit `6873327`) |
| 2 | Login + sessão assinada em cookie (a conta já nasce no banco) | ✅ (commit `7691266`) |
| 3 | Selo da Missão: campanha criada de propósito, selo gerado, selo desconhecido recusado | ✅ (commit `cd4b3c8`) |
| 4 | Papel pelo vínculo com a campanha; `GM_KEY` vira legado; cadastro com freio e interruptor | ✅ (commit `9297862`) |
| 5 | Conta obrigatória, papel derivado no servidor, e a entrada em páginas (`/entrar`, `/mesa`) | ✅ (commit `c09f960`) |
| 6 | O mestre outorga o papel, e a promoção vale na hora | ✅ (commit `c09f960`) |

**Entrega 4 fechada.** O papel de mestre deixou de ser "é a conta dona da campanha" e passou a ser uma
linha no vínculo (`membership.role`). O dono virou o **administrador** (apaga a missão), e quem cria
recebe o vínculo `gm` **na mesma instrução** que cria a campanha — um CTE que escreve, porque duas
tabelas que podem se separar deixariam o dono sem o papel na própria missão, em silêncio. Junto veio o
**cadastro**: `POST /api/accounts`, aberto por padrão, com teto (`REGISTER_PER_MINUTE`) e interruptor
(`REGISTRATION=closed`, que também esconde o botão na página de entrada). O que um cadastro entrega a um
estranho é pouco — entrar ainda exige o selo, e mestre ainda exige vínculo. O `GM_KEY` **não** saiu, e
agora está dito por quê: sem recuperação de senha, tirá-lo trancaria o grupo de fora. É legado assumido, e
sai quando a recuperação existir.

**Entrega 5 fechada — a conta virou a porta (ADR #20).** O convidado não sobreviveu ao uso: sem conta não
há vínculo (não há como ser promovido), não há nome estável e não há linha em `membership` — a lista de
missões nunca o encontraria. Agora `room:join` **recusa sem sessão**, o cliente manda só `{ code, key }`
(o nome é o da conta, o papel é calculado no servidor) e `GM_KEY` vazia deixou de significar "qualquer um
é mestre": vazia é **nenhuma escapatória**. Sem `SESSION_SECRET` não há login — e portanto não há mesa; o
boot grita em vez de abrir no escuro.

**Entrega 5 também é a entrada em páginas (ADR #21).** O `Lobby.tsx` (1025 linhas, sete perguntas numa
tela, duas delas ignoradas pelo servidor) virou quatro rotas: `/entrar` (conta), `/mesa` (missão),
`/` (a mesa) e `/local` (preparação sem servidor). Cada página faz **uma** pergunta, as guardas encadeiam
sozinhas e "Identificação na Ordem" passou a ser **somente leitura**: é a pessoa, não o personagem.

**Entrega 6 fechada — o mestre outorga o papel (ADR #22).** `POST /api/campaigns/:selo/role` grava o
vínculo, e `server/src/live.ts` avisa a mesa que já está aberta: a pessoa promovida comanda o mapa
**sem F5**, e o que foi gravado vale no próximo boot. O dono nunca é rebaixado; qualquer outro mestre
pode ser. A prática corrigiu duas coisas: a permissão, o alvo e a gravação viraram **um CTE só** (checar e
escrever em transações diferentes é uma janela para nada ser gravado), e **rebaixar dá token** — um mestre
não tem token, e um agente sem token não tem o que mover.

Três coisas que a prática corrigiu na entrega 4:

- **A lista virou "minhas mesas", não "minhas campanhas".** Quem entra numa missão passa a vê-la na
  lista, com o papel à mostra (`mestre` / `agente`) — é o caminho do agente para não redigitar o selo.
- **O `×` só aparece para o dono**, e o servidor confere de novo. A lista é conveniência; quem autoriza
  é o servidor.
- **A ordem dos ADRs estava trocada** desde a entrega anterior (#18 antes de #17). O log agora lê em
  ordem, de #1 a #19.

**Entrega 3 fechada.** A campanha deixou de nascer de carona: quem cria é a conta, e vira dona. O selo
é sorteado pelo servidor — `CORVO-AMBAR-VEU-74`, três palavras sem acento e dois dígitos, ~28 bits —
porque código escolhido à mão erra os dois lados (\"MALDICAO\" é adivinhável e dois mestres escolhem o
mesmo). Selo desconhecido **não entra e não cria nada**, e um contador derruba quem erra 20 vezes. Os
testes pararam de poluir o banco: criam a missão de que precisam e apagam no fim — prova: a tabela
passou de 18 campanhas (16 de lixo) para 1 depois de rodar os quatro scripts três vezes.

Duas coisas que a prática corrigiu, e uma delas vale para sempre:

- **`/api` virou o prefixo** de tudo que o servidor responde em HTTP. O `/campaigns` caiu no mesmo
  buraco que o `/auth/*`: sem rota no Caddy, resposta `index.html` com **status 200** — erro que se
  disfarça de sucesso. Duas vezes é sinal de que o problema não era a rota esquecida, era o desenho.
- **Falha ao apagar não recarregava a lista.** Com a lista velha na tela, apagar de novo dá 404 em
  cima de 404. Agora recarrega sempre.
- **A missão padrão só nasce com o banco vazio.** Antes ela voltava a cada boot: apagar e ver
  reaparecer faz duvidar do que ficou salvo.

**Fog por jogador (Fase 3) ficou fora deste slice**, de propósito: é lógica de jogo, não persistência.

**Slice fechado, 6 de 6.** A **Fase 3 também fechou**: o fog é individual (`visibleNow` calculado só
com os tokens do jogador), o servidor recusa `fog:discover` fora do raio desses tokens, o mestre vê a
cena inteira, e o painel da mesa permite vincular/desvincular um ator a um jogador (`player:assign`)
e travar/liberar o movimento por token. O critério — "o fog de cada um é individual" — está coberto
pelo `smoke.mjs`. O próximo WIP natural é a **Fase 4**.

O que a entrega 6 deixou de fora, de propósito: o painel só oferece promoção para quem está **na sala**,
mas a rota funciona para qualquer conta da missão — quem foi promovido desconectado entra como mestre na
próxima sessão. A tela não tem como listar contas que nunca entraram, e inventar uma lista de contas
seria pior do que a limitação.

**Fora do slice, pedido no meio do caminho: o painel do administrador (ADRs #23–#25).** Não havia
recuperação de senha — quem esquecesse ficava sem identidade até alguém abrir o `psql`. Agora a conta
`admin` (`ADMIN_ACCOUNT`) lista as contas — com o último acesso — e define senha em `/admin`; e pode
**delegar** a administração (coluna `is_admin`, migration 002), com a raiz presa ao nome para o painel
nunca ficar sem dono. É **nome/flag, não papel**: não dá poder na mesa e não derruba sessões abertas.
O mesmo painel passou a guardar a **configuração viva** (migration 003): cadastro aberto/fechado e a
**sala da casa**, mudando na hora sem editar `.env` nem reiniciar. Apagar conta ficou fora: deixaria missão
órfã.

---

## Pronto para começar (núcleo)

| # | Item | Onde | Pronto quando |
|---|---|---|---|
| S3 | **Testes de `shared/`** | `shared/` | ✅ suíte vitest em `shared/src/__tests__` (grid, LOS/visão, pathfinding, constantes, id) |

Que aconteceu com os outros:

- **S1 (persistir a cena)** virou a entrega 1 do slice — feita, e com o `persist.mjs` provando.
- **S2 (`JOIN_KEY`)** foi **cancelado**: o ADR #16 decidiu que quem controla a entrada é o vínculo
  com a campanha, não uma segunda senha compartilhada.
- **S4 (reconexão estável)** foi o que a entrega 2 entregou: a sessão assinada é o `actorId` estável,
  e agora cair, dar F5 ou voltar no dia seguinte não te transforma em outra pessoa.

---

## Backlog

**Liberado pela refatoração de UI** (é onde está a graça):

- Arrastar token do mestre para o jogador (o vínculo pelo seletor do painel já existe)
- Ficha de personagem (regras customizadas)
- Rolagem de dados com histórico
- Chat e log de eventos
- Voz (WebRTC)
- Biblioteca de mapas e tokens (upload pelo mestre)
- **Renomear missão** — hoje o nome só é escolhido na criação; quem errou cria outra

**Contas (o que ficou fora da entrega 4):**

- **Promover um agente a mestre** — a linha do vínculo já existe e o `room:join` já a lê; falta o botão
  (uma rota de dono + a lista de membros). É o que faz o vínculo valer para além de quem criou a missão
- **Apagar a própria conta** — mexe em campanha órfã: a missão pertence ao dono, e o dono pode querer ir
  embora. Decidir o que acontece com a missão dele faz parte da tarefa, não é detalhe

**Infra e produto:**

- Domínio + Cloudflare Access + túnel nomeado (URL fixa e acesso convidado)
- Escolher o nome do projeto e o domínio
- Push para o GitHub + CI (typecheck, testes de `shared/` e build do cliente já no workflow; falta o smoke com banco)
- Imagem de produção em registry

**Só se incomodar na prática:**

- Comprimir `walls`/`fog` na rede (bitset + RLE) — o roadmap já marca assim, e concordo

---

## Decisões de arquitetura

Nada aqui bloqueia jogar. Bloqueia **escalar sem retrabalho**.

| Assunto | Situação | Observação |
|---|---|---|
| Framework do cliente | **Decidido** | SPA Vite + React 19. A refatoração de UI terminou (commit `d701ac3`) sem fixar premissa contrária |
| Banco de dados | **Feito** | Postgres no ar com migrations e a cena em JSONB (ADR #17, entrega 1) |
| Framework de servidor | **Decidido** | Nada de NestJS — o servidor é máquina de estado quente, não CRUD |
| Site público e wiki | **Alvo** | Next estático + MDX no repo. Entra **depois** da mesa |
| Identidade | **Feito (entregas 2, 3 e 4)** | Login, sessão assinada em cookie, **cadastro** com freio e interruptor, papel de mestre pelo **vínculo** com a missão, e missão criada de propósito com selo gerado. O `GM_KEY` continua como legado, até existir recuperação de senha |
| Arquivos (mapas/tokens) | Pendente | Volume + Caddy vs. objeto (S3/MinIO) |
| Publicar o repositório | Pendente | Afeta CI e o Project board |

O alvo consolidado está em **`STACK.md`**. Este quadro diz *o que fazer agora*; aquele diz *para onde
isso aponta*.

---

## Fechado — não faremos

- **Port forwarding IPv4 + `sslip.io` + reserva de IP no DHCP.** O Cloudflare Tunnel (ADR #14)
  tornou o ramo inteiro desnecessário: nenhuma porta aberta, nada a configurar no roteador, e o
  IPv6 global fica fechado (ADR #13).

---

## Feito (últimos)

- ✅ **Papel pelo vínculo + cadastro** (entrega 4 do slice) — `membership.role` decide quem é mestre, o
  dono vira administrador, o vínculo `gm` nasce junto da campanha (um CTE que escreve), o cadastro
  entra com teto e interruptor, e a lista do lobby virou "minhas mesas" com o papel à mostra. Testes
  novos em `auth.mjs` (34 verificações, incluindo a conta criada pelo próprio cadastro entrando como
  agente), com a chave errada no bolso provando que o papel vem do vínculo. Verificado local e pela URL
  pública, mais `persist.mjs` atravessando um restart — ADR #19
- ✅ **Selo da Missão** (entrega 3 do slice) — campanha criada de propósito pela conta dona, selo
  sorteado (três palavras + dois dígitos), selo desconhecido recusado sem criar nada, apagar só pelo
  dono, e `/api` como prefixo único de tudo que o servidor responde em HTTP. Testes novos
  (`selo.mjs`, 25 verificações) e os antigos pararam de deixar campanha órfã — ADR #18, commit `cd4b3c8`
- ✅ Login e sessão assinada (entrega 2 do slice) — a conta entra por HTTP, o cookie `HttpOnly`
  chega no handshake do socket e o `room:join` passa a saber **quem** está falando: nome da conta,
  mestre pela conta dona da campanha sem senha nenhuma, e quem cai e volta é reconhecido (fim do id
  do socket como identidade). `GM_KEY` segue valendo como bootstrap. Verificado com `auth.mjs` (18/18)
  e `smoke.mjs` (19/19), local e pela URL pública — ADR #16, commit `7691266`
- ✅ Persistência (entrega 1 do slice) — Postgres, migrations, Selo da Missão e cena em JSONB que
  sobrevive ao restart do container (ADR #17). Verificado com `persist.mjs`, e a mesa funciona com o
  banco fora
- ✅ Refatoração de UI — tema ocultista, ícones SVG e suporte mobile (commit `d701ac3`, outra IA)
- ✅ Stack alvo consolidada em `STACK.md`
- ✅ Fase 2 — multiplayer com servidor autoritativo (ADR #1, #8, #9)
- ✅ `GM_KEY` — senha de mestre até o RBAC (ADR #12)
- ✅ IPv6 global fechado — a máquina respondia na internet sem port forwarding (ADR #13)
- ✅ Cloudflare Tunnel — acesso público sem abrir porta (ADR #14)
- ✅ Endurecimento: `fog:discover` validado, limite de taxa, mesma origem, container sem root
  (ADR #15) — smoke 19/19 local e pela URL pública
