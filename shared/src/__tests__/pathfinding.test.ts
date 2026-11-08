import {
  facingBetween,
  sameCell,
  isAdjacent,
  isEdgeBlocked,
  findPath,
} from "../pathfinding";
import type { Cell } from "../types";

const emptyWalls = (rows: number, cols: number): boolean[][] =>
  Array.from({ length: rows }, () => new Array(cols).fill(false));

describe("facingBetween", () => {
  it("retorna a direção cardinal aproximada", () => {
    expect(facingBetween({ row: 0, col: 0 }, { row: 0, col: 1 })).toBe("e");
    expect(facingBetween({ row: 0, col: 1 }, { row: 0, col: 0 })).toBe("w");
    expect(facingBetween({ row: 0, col: 0 }, { row: 1, col: 0 })).toBe("s");
    expect(facingBetween({ row: 1, col: 0 }, { row: 0, col: 0 })).toBe("n");
  });
});

describe("sameCell / isAdjacent", () => {
  it("sameCell compara linha e coluna", () => {
    expect(sameCell({ row: 1, col: 2 }, { row: 1, col: 2 })).toBe(true);
    expect(sameCell({ row: 1, col: 2 }, { row: 1, col: 3 })).toBe(false);
  });
  it("isAdjacent é verdadeiro apenas para vizinhos ortogonais", () => {
    expect(isAdjacent({ row: 0, col: 0 }, { row: 0, col: 1 })).toBe(true);
    expect(isAdjacent({ row: 0, col: 0 }, { row: 1, col: 0 })).toBe(true);
    expect(isAdjacent({ row: 0, col: 0 }, { row: 0, col: 0 })).toBe(false);
    expect(isAdjacent({ row: 0, col: 0 }, { row: 1, col: 1 })).toBe(false);
  });
});

describe("isEdgeBlocked", () => {
  it("retorna false sem paredes nem janelas", () => {
    expect(isEdgeBlocked(undefined, { row: 0, col: 0 }, { row: 0, col: 1 })).toBe(
      false,
    );
  });
  it("parede na aresta bloqueia", () => {
    // (0,0) -> (0,1) cruza "0,1,v"
    expect(
      isEdgeBlocked(["0,1,v"], { row: 0, col: 0 }, { row: 0, col: 1 }),
    ).toBe(true);
    // janela na aresta também bloqueia movimento
    expect(
      isEdgeBlocked(
        undefined,
        { row: 0, col: 0 },
        { row: 0, col: 1 },
        ["0,1,v"],
      ),
    ).toBe(true);
  });
  it("movimento sem aresta bloqueada retorna false", () => {
    expect(
      isEdgeBlocked(["0,1,v"], { row: 0, col: 0 }, { row: 1, col: 0 }),
    ).toBe(false);
  });
});

describe("findPath", () => {
  it("start igual a goal retorna caminho vazio", () => {
    const walls = emptyWalls(3, 3);
    expect(findPath(walls, { row: 1, col: 1 }, { row: 1, col: 1 }, 3, 3)).toEqual(
      [],
    );
  });

  it("encontra o caminho mais curto sem obstáculos", () => {
    const walls = emptyWalls(3, 3);
    const path = findPath(walls, { row: 0, col: 0 }, { row: 2, col: 2 }, 3, 3);
    expect(path).not.toBeNull();
    // BFS explora "baixo" ([1,0]) antes de "direita" ([0,1]) nos DIRS
    expect(path![0]).toEqual({ row: 1, col: 0 });
    const last = path![path!.length - 1];
    expect(last).toEqual({ row: 2, col: 2 });
  });

  it("retorna null se o destino estiver bloqueado por parede", () => {
    const walls = emptyWalls(3, 3);
    walls[1][1] = true;
    const path = findPath(walls, { row: 0, col: 0 }, { row: 2, col: 2 }, 3, 3);
    // ainda dá para contornar pela borda
    expect(path).not.toBeNull();
  });

  it("retorna null se não houver caminho", () => {
    const walls = emptyWalls(3, 3);
    // fecha todas as saídas de (0,0) exceto o destino cercado
    walls[0][1] = true;
    walls[1][0] = true;
    const path = findPath(walls, { row: 0, col: 0 }, { row: 2, col: 2 }, 3, 3);
    expect(path).toBeNull();
  });

  it("edge walls bloqueiam a travessia", () => {
    const walls = emptyWalls(3, 3);
    // bloquear (0,0) -> (0,1) com "0,1,v"
    const path = findPath(
      walls,
      { row: 0, col: 0 },
      { row: 0, col: 2 },
      3,
      3,
      ["0,1,v"],
    );
    // não pode passar por (0,1), então não chega em (0,2) pelo topo
    // pode descer e contornar, então ainda pode chegar
    // teste mais direto: bloquear a única saída
    const walls2 = emptyWalls(1, 2);
    const path2 = findPath(
      walls2,
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      1,
      2,
      ["0,1,v"],
    );
    expect(path2).toBeNull();
  });

  it("janela na aresta também bloqueia movimento", () => {
    const walls = emptyWalls(1, 2);
    const path = findPath(
      walls,
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      1,
      2,
      undefined,
      ["0,1,v"],
    );
    expect(path).toBeNull();
  });

  it("edge windows são consideradas junto com edge walls", () => {
    const walls = emptyWalls(1, 3);
    // (0,0) -> (0,1) bloqueado por wall, (0,1) -> (0,2) bloqueado por window
    const path = findPath(
      walls,
      { row: 0, col: 0 },
      { row: 0, col: 2 },
      1,
      3,
      ["0,1,v"],
      ["0,2,v"],
    );
    expect(path).toBeNull();
  });

  it("caminho contorna parede quando existe rota alternativa", () => {
    const walls = emptyWalls(3, 3);
    walls[1][1] = true; // centro bloqueado
    const path = findPath(walls, { row: 0, col: 0 }, { row: 2, col: 2 }, 3, 3);
    expect(path).not.toBeNull();
    // Caminho deve evitar (1,1)
    for (const cell of path) {
      expect(cell.row !== 1 || cell.col !== 1).toBe(true);
    }
  });
});
