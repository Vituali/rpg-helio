# PRD — HELIO v1.1 (pós-v1.0)

**Data:** 08/11/2026  
**Escopo:** Melhorias de jogabilidade após o v1.0 (Fases 0–3 já concluídas).  
**Objetivo:** Deixar a mesa parecer um produto completo para o jogador final, sem transformar o HELIO num game engine. O servidor continua autoridade; o cliente prevê localmente.

---

## Itens a implementar

| # | Item | Prioridade | Sinopse |
|---|------|------------|---------|
| 1 | **Character sheet** | Alta | Ficha de atributos do token (vida, sanidade, etc.) aberta pelo dono do token; mestre vê tudo. |
| 2 | **Dice roller** | Alta | Comando de rolagem de dados no chat (`/r 1d20+5`), resultado visível para todos da sala. |
| 4 | **Handouts** | Média | Mestre entrega textos/pistas para jogadores específicos; aparece no painel do jogador. |
| 5 | **Arrastar token** | Alta | Mover token arrastando com o mouse no canvas (além das setas). |
| 6 | **Iniciativa** | Média | Ordem de turno visível na mesa; mestre avança a vez. |
| 7 | **Renomear missão / excluir conta** | Baixa | Mestre renomeia missão; admin exclui conta de usuário. |

---

## Regras gerais (ADRs a respeitar)

- **ADR #4:** regras de validação idênticas em cliente (predição) e servidor (autoridade).
- **ADR #16:** a conta é a porta; identidade vem do cookie de sessão.
- **ADR #17:** banco fora não derruba a mesa (memória como fallback).
- **ADR #20:** o servidor decide o papel; o cliente não pede papel nem nome.
- **Fase 3 (fog):** per-player fog continua intacto; nada nesses itens vaza fog de outro jogador.

---

## 1. Character sheet

### Escopo
- Cada ator tem um objeto `sheet` (chave-valor livre, JSON) no `Actor`.
- Qualquer jogador abre a ficha do **seu próprio token**; o mestre abre a de qualquer ator.
- A ficha é um painel lateral (drawer) com campos editáveis (ex.: `Vida`, `Sanidade`, `Notas`).
- Alterações são enviadas ao servidor (`actor:sheet`) e validadas: só o dono (ou GM) escreve.

### Mudanças de código
- `shared/src/types.ts`: adicionar `sheet?: Record<string, string | number>` ao `Actor`.
- `server/src/index.ts`: handler `actor:sheet` (valida dono/GM, grava no ator, `bump`).
- `client/src/components/Sheet.tsx`: drawer com campos editáveis.
- `client/src/components/FogWarMap.tsx`: botão "Ficha" no painel de atores.

---

## 2. Dice roller

### Escopo
- Comando no chat: `/r <expressão>` (ex.: `/r 1d20+5`, `/r 2d6+3`).
- O servidor rola (não confia no cliente para o resultado aleatório) e publica no chat da sala como mensagem de sistema.
- Exemplo de resultado visível: `agente-teste rolou 1d20+5 = 17 (12 + 5)`.

### Mudanças de código
- `server/src/index.ts`: no handler `chat:message`, detectar prefixo `/r `, rolar, emitir mensagem de sistema no lugar da mensagem do usuário.
- `shared/src/lib/dice.ts` (novo): função `roll(expr: string) => { total, detalhes }` — usada pelo servidor (e opcionalmente pelo cliente para preview local).
- Cliente: nada de novo no chat (já existe); o resultado aparece como mensagem normal.

---

## 4. Handouts

### Escopo
- Mestre cria um handout (título + conteúdo) e entrega para um ou mais jogadores.
- Jogador vê o handout no seu painel lateral ("Documentos Recebidos").
- Handouts são persistidos na cena (survive F5) e visíveis apenas para os destinatários.

### Mudanças de código
- `shared/src/types.ts`: interface `Handout { id, title, content, to: string[] }`.
- `server/src/index.ts`: handlers `handout:create`, `handout:read`.
- `client/src/components/Handouts.tsx`: painel lateral do jogador.
- `client/src/components/FogWarMap.tsx`: botão para mestre criar handout.

---

## 5. Arrastar token com o mouse

### Escopo
- Jogador (dono do token) e mestre arrastam tokens com o mouse no canvas.
- Movimento é 1 casa por vez (adesivo à grade); não permite "teleporte livre".
- O cliente prevê o caminho e o servidor valida cada passo (reutiliza `canMove` e `findPath`).

### Mudanças de código
- `client/src/components/FogWarMap.tsx`: no `onPointerDown`/`onPointerUp`, detectar clique num token e arrasto para célula destino.
- Reutilizar `moveActorTo` + `advanceActor` existentes no `gameStore`.
- Servidor: nenhuma mudança nova (usa `actor:intent-move` existente).

---

## 6. Iniciativa

### Escopo
- Lista de iniciativa na mesa (painel lateral ou topbar).
- Mestre adiciona atores à iniciativa e define a ordem.
- Indica visual quem é a vez (marcador no token ou highlight).
- Mestre avança para o próximo turno.

### Mudanças de código
- `shared/src/types.ts`: `initiative?: { order: string[]; currentIndex: number }` na cena (ou no Room).
- `server/src/index.ts`: handlers `initiative:set`, `initiative:next`.
- `client/src/components/Initiative.tsx`: painel de turno.
- `client/src/components/FogWarMap.tsx`: integração no topbar.

---

## 7. Renomear missão / excluir conta

### Escopo
- Mestre renomeia a missão (altera o `name` da campanha no banco).
- Admin exclui uma conta de usuário (remove da campanha e do sistema).

### Mudanças de código
- `server/src/http.ts`: rota `PATCH /campaigns/:selo/name`.
- `server/src/http.ts`: rota `DELETE /admin/accounts/:id`.
- `client/src/screens/Mesa.tsx`: campo para mestre renomear.
- `client/src/screens/Admin.tsx`: botão de exclusão na lista de contas.

---

## Critérios de aceitação (por item)

1. **Character sheet:** dono do token edita ficha; GM vê todas; jogadores não veem fichas alheias; sobrevive a F5.
2. **Dice roller:** `/r 1d20+5` no chat produz resultado visível para todos; servidor rola (não confia no cliente).
3. **Handouts:** GM entrega texto a jogador; jogador vê no seu painel; não aparece para outros.
4. **Drag token:** arrastar token move 1 casa; parede bloqueia; servidor valida.
5. **Iniciativa:** lista de turno visível; GM avança a vez; marca quem está na vez.
6. **Renomear missão:** GM muda o nome; aparece no lobby. **Excluir conta:** admin remove conta; login dela é recusado.

---

## Não está em escopo (neste PRD)

- Sistema de regras automatizado (dano, condições de vitória).
- NPC com IA.
- Progressão de personagem entre campanhas.
- Vídeo/áudio.

---

## Plano de implementação (sequencial)

1. Escrever/revisar este PRD com o usuário.
2. Item 5 (Drag token) — mais simples, reutiliza infra existente.
3. Item 2 (Dice roller) — depende do chat já implementado.
4. Item 1 (Character sheet).
5. Item 4 (Handouts).
6. Item 6 (Iniciativa).
7. Item 7 (Renomear missão / excluir conta).
8. Typecheck + testes + build + commit + push após cada item.
