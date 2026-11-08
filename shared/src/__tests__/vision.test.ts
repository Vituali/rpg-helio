import { FOG_NONE, FOG_SEEN, FOG_VIS, FOG_REVEAL } from "../constants";
import {
  hasLOS,
  visibleCellsFrom,
  computeVision,
  mergeExplored,
} from "../vision";
import type { Cell, FogValue } from "../types";

const walls3x3 = (blockedCells: { row: number; col: number }[]): boolean[][] => {
  const w: boolean[][] = Array.from({ length: 3 }, () => new Array(3).fill(false));
  for (const { row, col } of blockedCells) w[row][col] = true;
  return w;
};

describe("hasLOS", () => {
  it("mesma célula enxerga a si mesma", () => {
    expect(hasLOS(walls3x3([]), 0, 0, 0, 0)).toBe(true);
  });

  it("linha reta sem parede enxerga", () => {
    expect(hasLOS(walls3x3([]), 0, 0, 0, 2)).toBe(true);
    expect(hasLOS(walls3x3([]), 0, 0, 2, 0)).toBe(true);
  });

  it("parede em bloco no meio bloqueia", () => {
    expect(hasLOS(walls3x3([{ row: 0, col: 1 }]), 0, 0, 0, 2)).toBe(false);
    expect(hasLOS(walls3x3([{ row: 1, col: 0 }]), 0, 0, 2, 0)).toBe(false);
  });

  it("parede no destino não bloqueia a própria visão do destino", () => {
    // destino é uma parede: ainda assim a linha chega até lá (não há parede no caminho)
    expect(hasLOS(walls3x3([{ row: 0, col: 2 }]), 0, 0, 0, 2)).toBe(true);
  });

  it("edge wall bloqueia a travessia da aresta", () => {
    // (0,0) -> (0,1) cruza a borda vertical oeste de (0,1): "0,1,v"
    expect(
      hasLOS(walls3x3([]), 0, 0, 0, 1, ["0,1,v"]),
    ).toBe(false);
    // sem edge wall, enxerga
    expect(hasLOS(walls3x3([]), 0, 0, 0, 1)).toBe(true);
  });

  it("edge wall horizontal bloqueia movimento vertical", () => {
    // (0,0) -> (1,0) cruza a borda horizontal norte de (1,0): "1,0,h"
    expect(
      hasLOS(walls3x3([]), 0, 0, 1, 0, ["1,0,h"]),
    ).toBe(false);
  });
});

describe("visibleCellsFrom", () => {
  it("retorna células dentro do raio com LOS", () => {
    const origin: Cell = { row: 1, col: 1 };
    const cells = visibleCellsFrom(walls3x3([]), origin, 1, 3, 3);
    // visão 1: distância euclidiana <= 1, então só cruzais + origem
    const ids = cells.map((c) => `${c.row},${c.col}`);
    expect(ids).toContain("1,1"); // origem
    expect(ids).toContain("0,1"); // cima
    expect(ids).toContain("2,1"); // baixo
    expect(ids).toContain("1,0"); // esquerda
    expect(ids).toContain("1,2"); // direita
    // diagonais têm dist 1.414 > 1, não entram
    expect(ids).not.toContain("0,0");
    expect(ids).not.toContain("2,2");
    expect(cells.length).toBe(5);
  });

  it("parede no caminho exclui células além dela", () => {
    const origin: Cell = { row: 0, col: 0 };
    const cells = visibleCellsFrom(walls3x3([{ row: 0, col: 1 }]), origin, 2, 3, 3);
    const ids = cells.map((c) => `${c.row},${c.col}`);
    // (0,2) está além da parede em (0,1) na mesma linha -> não enxerga
    expect(ids).not.toContain("0,2");
    // (0,0) e (0,1) ainda são visíveis (origem e adjacente)
    expect(ids).toContain("0,0");
    expect(ids).toContain("0,1");
  });
});

describe("computeVision", () => {
  it("VIS vira SEEN e atores marcam VIS no raio de visão", () => {
    const fog: FogValue[][] = [
      [FOG_VIS, FOG_VIS],
      [FOG_VIS, FOG_VIS],
    ];
    const walls: boolean[][] = [
      [false, false],
      [false, false],
    ];
    const actors = [{ row: 0, col: 0, vision: 1 }];
    const next = computeVision(fog, walls, actors, 2, 2);
    // (0,0) era VIS e o ator está nele -> continua VIS
    expect(next[0][0]).toBe(FOG_VIS);
    // (0,1) e (1,0) estão no raio 1 -> VIS
    expect(next[0][1]).toBe(FOG_VIS);
    expect(next[1][0]).toBe(FOG_VIS);
    // (1,1) tem dist 1.414 > 1, não entra no raio -> vira SEEN (era VIS)
    expect(next[1][1]).toBe(FOG_SEEN);
  });

  it("parede no destino é visível (até a parede)", () => {
    const fog: FogValue[][] = [[FOG_NONE, FOG_NONE], [FOG_NONE, FOG_NONE]];
    const walls: boolean[][] = [
      [false, true],
      [false, false],
    ];
    const actors = [{ row: 0, col: 0, vision: 2 }];
    const next = computeVision(fog, walls, actors, 2, 2);
    // (0,1) é parede mas é destino do raio -> marcada como VIS
    expect(next[0][1]).toBe(FOG_VIS);
    // (1,0) é vizinha -> VIS
    expect(next[1][0]).toBe(FOG_VIS);
    // (1,1) está bloqueada pela quina da parede em (0,1) (Amanatides-Woo) -> NONE
    expect(next[1][1]).toBe(FOG_NONE);
  });
});

describe("mergeExplored", () => {
  it("marca células como exploradas apenas se forem FOG_NONE", () => {
    const fog: FogValue[][] = [
      [FOG_NONE, FOG_SEEN],
      [FOG_VIS, FOG_NONE],
    ];
    const cells: Cell[] = [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 1 },
    ];
    const next = mergeExplored(fog, cells, FOG_SEEN);
    expect(next[0][0]).toBe(FOG_SEEN); // era NONE -> vira SEEN
    expect(next[0][1]).toBe(FOG_SEEN); // já era SEEN -> mantém
    expect(next[1][1]).toBe(FOG_SEEN); // era NONE -> vira SEEN
    // (1,0) não está na lista -> mantém VIS
    expect(next[1][0]).toBe(FOG_VIS);
  });
});
