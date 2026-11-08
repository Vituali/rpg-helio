/**
 * Rolagem de dados para o HELIO.
 *
 * Aceita expressões como:
 *   1d20      -> um d20
 *   d20       -> um d20 (mesmo que 1d20)
 *   2d6+3     -> dois d6 mais 3
 *   3d8-1     -> três d8 menos 1
 *   1d20+5-2  -> um d20 mais 5 menos 2
 *
 * O servidor é a autoridade do resultado aleatório; o cliente pode usar a
 * mesma função só para preview local.
 */

export interface RollDetail {
  kind: "die" | "mod";
  faces: number;      // só para kind === "die"
  count: number;      // só para kind === "die"
  rolls: number[];    // resultados individuais de cada dado
  subtotal: number;   // soma dos dados (ou o valor do modificador)
  value: number;      // valor final deste termo
}

export interface RollResult {
  expression: string;   // expressão normalizada (ex.: "1d20+5")
  total: number;        // resultado final
  details: RollDetail[]; // detalhamento por termo
}

/**
 * Faz o parse de uma expressão de dados e rola.
 * Retorna null se a expressão for inválida.
 */
export function roll(expr: string): RollResult | null {
  const clean = expr.replace(/\s+/g, "").toLowerCase();
  if (!clean) return null;

  // Separa termos por + ou -, mantendo o sinal.
  // Exemplo: "1d20+5-2" -> ["1d20", "+5", "-2"]
  const terms = clean.split(/(?=[+-])/);
  if (terms.length === 0) return null;

  const details: RollDetail[] = [];
  let total = 0;

  for (const raw of terms) {
    if (!raw) continue;
    const sign = raw.startsWith("-") ? -1 : 1;
    const body = raw.replace(/^[+-]/, "");

    const dieMatch = body.match(/^(\d*)d(\d+)$/);
    if (dieMatch) {
      const count = dieMatch[1] ? Number(dieMatch[1]) : 1;
      const faces = Number(dieMatch[2]);
      if (!Number.isFinite(count) || !Number.isFinite(faces) || count < 1 || count > 100 || faces < 2 || faces > 1000) {
        return null;
      }
      const rolls: number[] = [];
      let subtotal = 0;
      for (let i = 0; i < count; i += 1) {
        const r = Math.floor(Math.random() * faces) + 1;
        rolls.push(r);
        subtotal += r;
      }
      const value = subtotal * sign;
      total += value;
      details.push({
        kind: "die",
        faces,
        count,
        rolls,
        subtotal,
        value,
      });
    } else {
      const num = Number(body);
      if (!Number.isFinite(num)) return null;
      const value = num * sign;
      total += value;
      details.push({
        kind: "mod",
        faces: 0,
        count: 1,
        rolls: [num],
        subtotal: num,
        value,
      });
    }
  }

  // Normaliza a expressão para exibição (ex.: "1d20+5")
  const normalized = terms.map((t) => {
    const s = t.startsWith("-") ? "-" : t.startsWith("+") ? "+" : "";
    return s + t.replace(/^[+-]/, "");
  }).join("");

  return { expression: normalized, total, details };
}
