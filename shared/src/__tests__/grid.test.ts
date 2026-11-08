import {
  makeGrid,
  makeFog,
  makeWalls,
  cloneGrid,
  resizeGrid,
  inBounds,
  clamp,
} from "../grid";
import { FOG_NONE } from "../constants";
import type { FogValue } from "../types";

describe("makeGrid", () => {
  it("cria uma grade rows x cols preenchida com o valor informado", () => {
    const g = makeGrid(2, 3, 9);
    expect(g).toHaveLength(2);
    expect(g[0]).toHaveLength(3);
    expect(g[0][0]).toBe(9);
    expect(g[1][2]).toBe(9);
  });
});

describe("makeFog", () => {
  it("cria uma grade preenchida com FOG_NONE", () => {
    const f = makeFog(2, 2);
    expect(f).toHaveLength(2);
    expect(f[0]).toHaveLength(2);
    expect(f[0][0]).toBe(FOG_NONE);
    expect(f[1][1]).toBe(FOG_NONE);
  });
});

describe("makeWalls", () => {
  it("cria uma grade preenchida com false", () => {
    const w = makeWalls(2, 2);
    expect(w[0][0]).toBe(false);
    expect(w[1][1]).toBe(false);
  });
});

describe("cloneGrid", () => {
  it("copia cada linha rasamente", () => {
    const src = [
      [true, false],
      [false, true],
    ];
    const clone = cloneGrid(src);
    expect(clone).toEqual(src);
    expect(clone).not.toBe(src);
    expect(clone[0]).not.toBe(src[0]);
  });
});

describe("resizeGrid", () => {
  it("expande a grade preenchendo com fill", () => {
    const prev = [
      [true, false],
      [false, true],
    ];
    const next = resizeGrid(prev, 4, 4, false);
    expect(next).toHaveLength(4);
    expect(next[0]).toHaveLength(4);
    // conteúdo preservado
    expect(next[0][0]).toBe(true);
    expect(next[0][1]).toBe(false);
    expect(next[1][1]).toBe(true);
    // novas células preenchidas com fill
    expect(next[2][2]).toBe(false);
    expect(next[3][3]).toBe(false);
  });

  it("encolhe a grade descartando o que não couber", () => {
    const prev = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];
    const next = resizeGrid(prev, 2, 2, 0);
    expect(next).toEqual([
      [1, 2],
      [4, 5],
    ]);
  });
});

describe("inBounds", () => {
  it("retorna true dentro dos limites e false fora", () => {
    expect(inBounds(0, 0, 5, 5)).toBe(true);
    expect(inBounds(4, 4, 5, 5)).toBe(true);
    expect(inBounds(-1, 0, 5, 5)).toBe(false);
    expect(inBounds(0, -1, 5, 5)).toBe(false);
    expect(inBounds(5, 0, 5, 5)).toBe(false);
    expect(inBounds(0, 5, 5, 5)).toBe(false);
  });
});

describe("clamp", () => {
  it("mantém o valor dentro do intervalo", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});
