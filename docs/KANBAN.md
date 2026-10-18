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

🔵 **Slice "a sessão que sobrevive"** — persistência + conta + identidade (ADR #16 e #17). É um
assunto só: sem identidade, "salvar" não tem dono. Quatro entregas, cada uma utilizável sozinha.

| # | Entrega | Estado |
|---|---|---|
| 1 | Postgres + migrations + cena que sobrevive ao restart | ✅ (commit `6873327`) |
| 2 | Login + sessão assinada em cookie (a conta já nasce no banco) | 🔜 próximo |
| 3 | Selo da Missão como código da campanha (hoje `ROOM_CODE` é fixo) | ⏳ |
| 4 | Papel pelo vínculo com a campanha; `GM_KEY` vira legado | ⏳ |

**Fog por jogador (Fase 3) fica fora deste slice**, de propósito: é lógica de jogo, não persistência,
e entraria só para inflar o WIP.

---

## Pronto para começar (núcleo)

| # | Item | Onde | Pronto quando |
|---|---|---|---|
| S3 | **Testes de `shared/`** | `shared/` | Colisão, LOS, pathfinding e validação cobertas, rodando sem dependência nova |

Que aconteceu com os outros:

- **S1 (persistir a cena)** virou a entrega 1 do slice — feita, e com o `persist.mjs` provando.
- **S2 (`JOIN_KEY`)** foi **cancelado**: o ADR #16 decidiu que quem controla a entrada é o vínculo
  com a campanha, não uma segunda senha compartilhada.
- **S4 (reconexão estável)** é justamente o que a entrega 2 entrega: a sessão assinada é o
  `actorId` estável.

---

## Backlog

**Liberado pela refatoração de UI** (é onde está a graça):

- Fog por jogador (`visibleNow`) — definição de pronto da Fase 3
- Vincular um jogador a um token que já existe
- Ficha de personagem (regras customizadas)
- Rolagem de dados com histórico
- Chat e log de eventos
- Voz (WebRTC)
- Biblioteca de mapas e tokens (upload pelo mestre)

**Infra e produto:**

- Domínio + Cloudflare Access + túnel nomeado (URL fixa e acesso convidado)
- Escolher o nome do projeto e o domínio
- Push para o GitHub + CI (smoke + testes de `shared/`)
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
| Identidade | **Em andamento** | A conta e o `scrypt` já estão no banco; falta o login e a sessão no cookie (ADR #16, entrega 2) |
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
