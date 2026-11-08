import { uid } from "../id";

describe("uid", () => {
  it("gera ids únicos com prefixo", () => {
    const a = uid("tok");
    const b = uid("tok");
    expect(a).toMatch(/^tok_[0-9a-z]+$/);
    expect(b).toMatch(/^tok_[0-9a-z]+$/);
    expect(a).not.toBe(b);
  });

  it("usa prefixo padrão 'id' quando não informado", () => {
    const a = uid();
    expect(a).toMatch(/^id_[0-9a-z]+$/);
  });

  it("gera ids diferentes em chamadas sucessivas (mesmo mesmo milissegundo)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i += 1) ids.add(uid("x"));
    expect(ids.size).toBe(100);
  });
});
