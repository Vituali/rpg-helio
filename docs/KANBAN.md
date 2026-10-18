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

**WIP = 1** para mudança grande em `client/`. Não abrir a Fase 3 enquanto a refatoração de UI não
terminar — as duas mexem no `gameStore`, e a segunda a mexer vai perder.

---

## Em andamento (WIP = 1)

- 🔵 **Refatoração da UI** *(outra IA)* — `client/`

---

## Pronto para começar — sem conflito com a UI

| # | Item | Onde | Pronto quando |
|---|---|---|---|
| S1 | **Persistir a cena em disco** | `server/` | Reiniciar o container e a sala voltar com mapa, paredes, fog e tokens |
| S2 | **`JOIN_KEY`** (senha de jogador) | `server/` (campo do lobby é `client/`) | Smoke prova: jogador sem a senha é recusado quando `JOIN_KEY` está definida |
| S3 | **Testes de `shared/`** | `shared/` | Colisão, LOS, pathfinding e validação cobertas, rodando sem dependência nova |
| S4 | **Reconexão estável por `actorId`** | `server/` (sessão assinada) | Cair e voltar mantém o mesmo token e o mesmo papel |

---

## Backlog

**Travado pela refatoração de UI** (é onde está a graça, mas não agora):

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

## Decisões de arquitetura em aberto

Nada aqui bloqueia jogar. Bloqueia **escalar sem retrabalho**.

| Assunto | Situação | Observação |
|---|---|---|
| Framework do cliente | Em discussão | **Precisa ser decidido antes da refatoração de UI terminar**, senão a refatoração pode fixar premissas erradas |
| Banco de dados | Em discussão | Sequência proposta: arquivo JSON (agora) → SQLite (contas/campanhas) → Postgres (escala) |
| Identidade | Pendente | Hoje é o id do socket. Sessão assinada é pré-requisito de RBAC **e** de reconexão (S4) |
| Arquivos (mapas/tokens) | Pendente | Volume + Caddy vs. objeto (S3/MinIO) |
| Publicar o repositório | Pendente | Afeta CI e o Project board |

---

## Fechado — não faremos

- **Port forwarding IPv4 + `sslip.io` + reserva de IP no DHCP.** O Cloudflare Tunnel (ADR #14)
  tornou o ramo inteiro desnecessário: nenhuma porta aberta, nada a configurar no roteador, e o
  IPv6 global fica fechado (ADR #13).

---

## Feito (últimos)

- ✅ Fase 2 — multiplayer com servidor autoritativo (ADR #1, #8, #9)
- ✅ `GM_KEY` — senha de mestre até o RBAC (ADR #12)
- ✅ IPv6 global fechado — a máquina respondia na internet sem port forwarding (ADR #13)
- ✅ Cloudflare Tunnel — acesso público sem abrir porta (ADR #14)
- ✅ Endurecimento: `fog:discover` validado, limite de taxa, mesma origem, container sem root
  (ADR #15) — smoke 19/19 local e pela URL pública
