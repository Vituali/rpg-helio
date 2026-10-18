# Servidor autoritativo (Fase 2)

Ainda **não implementado**. Aqui vai viver o servidor Node + Socket.IO que
guarda o estado da cena e valida as ações dos jogadores.

Plano em [`../docs/ROADMAP.md`](../docs/ROADMAP.md) — Fase 2. Contrato de
mensagens e regras em [`../docs/ARQUITETURA.md`](../docs/ARQUITETURA.md).

Resumo do que vai morar aqui:

```
server/
├── src/
│   ├── index.ts        # boot do Socket.IO + CORS
│   ├── rooms.ts        # salas com código (HELIO-XXXX)
│   ├── scene.ts        # estado autoritativo da cena
│   ├── validate.ts     # validação de intenções (move, permissão, parede)
│   └── compress.ts     # bitset + RLE para walls/fog na rede
├── Dockerfile
└── package.json
```

A pasta `client/src/game/` é **lógica pura** e será reaproveitada aqui (extraída
para um pacote `shared/` no início da Fase 2). Ver `docs/DECISOES.md` #4.
