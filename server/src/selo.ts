/**
 * Selo da Missão — o código que o mestre dita e o grupo digita (ADR #18).
 *
 * O selo é o convite do convidado: quem não tem conta entra por ele, então ele
 * precisa ser **difícil de adivinhar** e, ao mesmo tempo, **ditável em voz
 * alta**. Código escolhido à mão erra os dois lados: "MALDICAO" é fácil de
 * adivinhar e dois mestres escolhem o mesmo.
 *
 * Daí três palavras distintas mais dois dígitos:
 *
 *   CORVO-AMBAR-VEU-74
 *
 * As palavras são curtas, sem acento e sem par que soe igual na leitura
 * (`LENTE` ficou e `LENTO` não). Sem acento porque o código é digitado do que se
 * ouviu — e quem digitar com acento mesmo assim acerta, porque `normalizeCode`
 * remove.
 *
 * A lista é validada ao carregar: palavra repetida, comprida ou fora de A-Z
 * derruba o boot com a mensagem na cara, em vez de virar um selo esquisito que
 * só aparece meses depois.
 */

/** Palavras do selo. A-Z, de 3 a 7 letras, sem acento, todas distintas. */
const WORDS = [
  // Bichos
  "CORVO",
  "LOBO",
  "RAPOSA",
  "GATO",
  "RATO",
  "URSO",
  "TIGRE",
  "AGUIA",
  "COBRA",
  "ARARA",
  "PEIXE",
  "TUBARAO",
  "POLVO",
  "JAVALI",
  "BODE",
  "MOSCA",
  "ABELHA",
  "VESPA",
  "LOUSA",
  "CERVO",
  // Ofício oculto
  "VEU",
  "RITUAL",
  "SIGILO",
  "SELO",
  "ALTAR",
  "VELA",
  "CIRIO",
  "GRIMOR",
  "MALDIC",
  "FEITICO",
  "SOMBRA",
  "ESPECTO",
  "ABISMO",
  "VORTICE",
  "PORTAL",
  "CHAVE",
  "COFRE",
  "AMULETO",
  "PRISMA",
  "ORACULO",
  "PROFETA",
  "CULTO",
  "SEITA",
  "ORDEM",
  "CAOS",
  "MORTE",
  "ALMA",
  "SANTO",
  "DEMONIO",
  "ANJO",
  "ESPIRTO",
  // Matéria
  "AGUA",
  "FOGO",
  "TERRA",
  "VENTO",
  "GELO",
  "FUMACA",
  "BRASA",
  "CINZA",
  "AMBAR",
  "FERRO",
  "PRATA",
  "OURO",
  "COBRE",
  "SAL",
  "AREIA",
  "PEDRA",
  "LAMA",
  "MUSGO",
  "RAIZ",
  "FOLHA",
  "TRONCO",
  "SEMENTE",
  "ESPINHO",
  "JUNCO",
  "CAL",
  "BREU",
  // Objetos
  "LENTE",
  "ESPELHO",
  "VIDRO",
  "AGULHA",
  "LAMINA",
  "ADAGA",
  "ESPADA",
  "ESCUDO",
  "MACHADO",
  "ARCO",
  "FLECHA",
  "LANTER",
  "RODA",
  "DISCO",
  "CUBO",
  "ANEL",
  "COROA",
  "TRONO",
  "TORRE",
  "PORTA",
  "JANELA",
  "ESCADA",
  "PONTE",
  "POCO",
  "MURALHA",
  "FORJA",
  // Lugares
  "ILHA",
  "MONTE",
  "VALE",
  "CAVERNA",
  "GRUTA",
  "PANTANO",
  "DESERTO",
  "FLORES",
  "MAR",
  "ONDA",
  "MARE",
  "RIO",
  "LAGO",
  "FONTE",
  "CHUVA",
  "NEVE",
  "GEADA",
  "TROVAO",
  "RAIO",
  "NUVEM",
  "NEBLINA",
  "NOITE",
  "DIA",
  "AURORA",
  "CREPUS",
  // Temperamento
  "TRISTE",
  "FEROZ",
  "ETERNO",
  "VAZIO",
  "PURO",
  "OCULTO",
  "ANTIGO",
  "FRIO",
  "QUENTE",
  "DOCE",
  "AMARGO",
  "RAPIDO",
  "SABIO",
  "LOUCO",
  "BRAVO",
  "CALMO",
  "SURDO",
  "CEGO",
  "MUDO",
  "NOBRE",
  "PUTRIDO",
  // Cores
  "AZUL",
  "VERDE",
  "RUBRO",
  "NEGRO",
  "BRANCO",
  "DOURADO",
  "OLIVA",
  // Contagem
  "PRIMEIR",
  "SEGUNDO",
  "TERCO",
  "QUARTO",
  "QUINTO",
  "SETIMO",
  "OITAVO",
  "NONO",
  "DECIMO",
];

/** Uma palavra: de 3 a 7 letras, só A-Z. */
const WORD_SHAPE = /^[A-Z]{3,7}$/;

// Falha cedo e alto: isto é constante, e constante errada é bug de boot.
const seen = new Set<string>();
for (const word of WORDS) {
  if (!WORD_SHAPE.test(word)) throw new Error(`palavra inválida no selo: "${word}"`);
  if (seen.has(word)) throw new Error(`palavra repetida no selo: "${word}"`);
  seen.add(word);
}
if (WORDS.length < 64) {
  throw new Error(`lista do selo curta demais (${WORDS.length}) para ter entropia`);
}

/** Teto do código normalizado. Três palavras de 7 + dígitos cabem com folga. */
const MAX_CODE = 32;

/**
 * Forma canônica de um código: sem espaço nas pontas, **sem acento**, em
 * maiúsculas.
 *
 * O acento sai porque o selo é ditado em voz alta: quem ouve "âmbar" e digita
 * `ÂMBAR` tem que entrar do mesmo jeito. Como o selo gerado nunca tem acento, a
 * limpeza só pode ajudar — e ela também conserta código antigo digitado com
 * acento (`MALDIÇÃO` e `MALDICAO` são a mesma mesa).
 */
export function normalizeCode(code: unknown): string {
  return String(code ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .slice(0, MAX_CODE);
}

/** Um dos dígitos que fecham o selo: ajuda a separar selo de selo. */
function twoDigits(): string {
  return String(10 + Math.floor(Math.random() * 90));
}

/**
 * Sorteia um selo. **Não** consulta o banco: quem chama tenta de novo se o
 * sorteio colidir (ver `createCampaign`). São ~28 bits de espaço (uns 400
 * milhões): com uma mesa por semana, colisão é evento de uma vida — e o `unique`
 * do banco mais o retry resolvem em silêncio.
 *
 * Três palavras **distintas**: `CORVO-CORVO-CORVO-42` é válido e feio.
 */
export function newSelo(): string {
  const picked: string[] = [];
  while (picked.length < 3) {
    const word = WORDS[Math.floor(Math.random() * WORDS.length)];
    if (!picked.includes(word)) picked.push(word);
  }
  return [...picked, twoDigits()].join("-");
}
