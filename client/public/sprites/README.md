# Sprites dos atores

Solte aqui os spritesheets em PNG. O jogo procura por `/sprites/<chave>.png`,
onde `<chave>` é o campo **Sprite** de cada ator no painel lateral (padrão: `hero`).

## Formato do arquivo

Uma grade de **4 linhas** (direções) × **N colunas** (frames de caminhada):

| Linha | Direção |
|---|---|
| 0 | Sul (de frente) |
| 1 | Oeste |
| 2 | Leste |
| 3 | Norte (de costas) |

```
        col 0    col 1    col 2    col 3
       ┌────────┬────────┬────────┬────────┐
  S    │ frame  │ frame  │ frame  │ frame  │
  W    │ frame  │ frame  │ frame  │ frame  │
  E    │ frame  │ frame  │ frame  │ frame  │
  N    │ frame  │ frame  │ frame  │ frame  │
       └────────┴────────┴────────┴────────┘
```

- Frame padrão: **32×32 px** (ajustável).
- Recomendado: 4 frames por direção.
- O frame exibido é `floor(tempo_andando × 8) % N` — a 8 fps.
- PNG com fundo transparente.

## Sem arquivo? Sem problema

Se o PNG não existir, o jogo usa um **desenhador procedural** (um humanóide com
pernas que alternam e olhos que apontam para a direção). Ou seja: dá para jogar e
testar movimento sem nenhuma arte. Ver `docs/DECISOES.md` #7.

## Chaves por ator

Cada ator tem o próprio campo `sprite`. Exemplos:

```
hero.png      → bravo
ocultista.png → ocultista
monstro.png   → criatura
```
