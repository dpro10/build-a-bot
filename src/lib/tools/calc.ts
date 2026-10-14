/**
 * A tiny, safe arithmetic evaluator (no eval): + - * / % ^, parentheses, decimals,
 * unary minus, and a few functions. Used by the calculate tool.
 */
type Tok = { t: "num"; v: number } | { t: "op"; v: string } | { t: "lp" } | { t: "rp" } | { t: "fn"; v: string } | { t: "comma" };

const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  log: Math.log10,
  ln: Math.log,
};

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const s = src.replace(/,(?=\d{3}\b)/g, "").replace(/×/g, "*").replace(/÷/g, "/");
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.eE]/.test(s[j])) j++;
      const v = Number(s.slice(i, j));
      if (Number.isNaN(v)) throw new Error(`Bad number near "${s.slice(i, j)}"`);
      out.push({ t: "num", v });
      i = j;
      continue;
    }
    if (/[a-z]/i.test(c)) {
      let j = i;
      while (j < s.length && /[a-z]/i.test(s[j])) j++;
      const name = s.slice(i, j).toLowerCase();
      if (name === "pi") out.push({ t: "num", v: Math.PI });
      else if (name === "e") out.push({ t: "num", v: Math.E });
      else if (FUNCS[name]) out.push({ t: "fn", v: name });
      else throw new Error(`Unknown name "${name}"`);
      i = j;
      continue;
    }
    if ("+-*/%^".includes(c)) out.push({ t: "op", v: c });
    else if (c === "(") out.push({ t: "lp" });
    else if (c === ")") out.push({ t: "rp" });
    else if (c === ",") out.push({ t: "comma" });
    else throw new Error(`Unexpected "${c}"`);
    i++;
  }
  return out;
}

export function calculate(expression: string): number {
  if (expression.length > 300) throw new Error("Expression too long");
  const tokens = tokenize(expression);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(): number {
    let v = parseTerm();
    while (peek()?.t === "op" && ["+", "-"].includes((peek() as { v: string }).v)) {
      const op = (next() as { v: string }).v;
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseFactor();
    while (peek()?.t === "op" && ["*", "/", "%"].includes((peek() as { v: string }).v)) {
      const op = (next() as { v: string }).v;
      const r = parseFactor();
      if (op === "*") v *= r;
      else if (op === "/") {
        if (r === 0) throw new Error("Division by zero");
        v /= r;
      } else v %= r;
    }
    return v;
  }
  function parseFactor(): number {
    const base = parseUnary();
    if (peek()?.t === "op" && (peek() as { v: string }).v === "^") {
      next();
      return base ** parseFactor();
    }
    return base;
  }
  function parseUnary(): number {
    if (peek()?.t === "op" && (peek() as { v: string }).v === "-") {
      next();
      return -parseUnary();
    }
    if (peek()?.t === "op" && (peek() as { v: string }).v === "+") {
      next();
      return parseUnary();
    }
    return parsePrimary();
  }
  function parsePrimary(): number {
    const tok = next();
    if (!tok) throw new Error("Unexpected end");
    if (tok.t === "num") {
      // Percent sugar: "15%" → 0.15 when followed by nothing numeric.
      return tok.v;
    }
    if (tok.t === "lp") {
      const v = parseExpr();
      if (next()?.t !== "rp") throw new Error("Missing )");
      return v;
    }
    if (tok.t === "fn") {
      if (next()?.t !== "lp") throw new Error(`Expected ( after ${tok.v}`);
      const args: number[] = [];
      if (peek()?.t !== "rp") {
        args.push(parseExpr());
        while (peek()?.t === "comma") {
          next();
          args.push(parseExpr());
        }
      }
      if (next()?.t !== "rp") throw new Error("Missing )");
      return FUNCS[tok.v](...args);
    }
    throw new Error("Unexpected token");
  }

  const result = parseExpr();
  if (pos < tokens.length) throw new Error("Unexpected input at the end");
  if (!Number.isFinite(result)) throw new Error("Result is not a finite number");
  return result;
}
