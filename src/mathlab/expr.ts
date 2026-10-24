/**
 * A small formula reader for MATH LAB's YOUR CURVE: what a player types,
 * like `1 + 2cos(5t)` or `exp(sin(t)) - 2cos(4t)`, turned into a function.
 * Never `eval`: the text is parsed into a tree of plain operations, so
 * nothing typed can run as code.
 *
 *   sum     = product (('+' | '-') product)*
 *   product = unary (('*' | '/') unary | power)*     -- 2t and 3sin(t) multiply
 *   unary   = '-' unary | power                      -- -2^2 = -(2^2)
 *   power   = atom ('^' unary)?                      -- right to left: 2^3^2 = 2^9
 *   atom    = number | name | func atom-or-power | '(' sum ')'   -- sin(t), sin t
 */

const FUNCS: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  floor: Math.floor,
  sign: Math.sign,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Fn = (v: Record<string, number>) => number;

/**
 * Compile `src` into a function of the named variables. Throws an Error with
 * a message a player can act on ("unknown name 'x'", "missing ')'").
 */
export function compile(src: string, vars: string[]): Fn {
  const known = [...Object.keys(FUNCS), ...Object.keys(CONSTS), ...vars].sort((p, q) => q.length - p.length);
  // letters run together (sint, 2tcos) are split into the names they are made of, longest first
  const split = (run: string): string[] => {
    const out: string[] = [];
    let k = 0;
    while (k < run.length) {
      const name = known.find((n) => run.startsWith(n, k));
      if (!name) return [run]; // not made of known names: report it whole
      out.push(name);
      k += name.length;
    }
    return out;
  };
  const toks = (src.toLowerCase().match(/\d*\.\d+|\d+|[a-z]+|[-+*/^()]|\S/g) ?? []).flatMap((t) => (/^[a-z]+$/.test(t) ? split(t) : [t]));
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const fail = (msg: string): never => {
    throw new Error(msg);
  };

  function sum(): Fn {
    let f = product();
    while (peek() === '+' || peek() === '-') {
      const op = take();
      const a = f;
      const b = product();
      f = op === '+' ? (v) => a(v) + b(v) : (v) => a(v) - b(v);
    }
    return f;
  }
  function product(): Fn {
    let f = unary();
    for (;;) {
      const t = peek();
      if (t === '*' || t === '/') {
        take();
        const a = f;
        const b = unary();
        f = t === '*' ? (v) => a(v) * b(v) : (v) => a(v) / b(v);
      } else if (t !== undefined && (/^[a-z(]/.test(t) || /^\d|^\./.test(t))) {
        // written side by side: 2t, 3sin(t), (t)(t)
        const a = f;
        const b = power();
        f = (v) => a(v) * b(v);
      } else return f;
    }
  }
  function power(): Fn {
    const base = atom();
    if (peek() !== '^') return base;
    take();
    const exp = unary();
    return (v) => Math.pow(base(v), exp(v));
  }
  function unary(): Fn {
    if (peek() === '-') {
      take();
      const a = unary();
      return (v) => -a(v);
    }
    if (peek() === '+') {
      take();
      return unary();
    }
    return power();
  }
  function atom(): Fn {
    const t = take();
    if (t === undefined) return fail('the formula ends too soon');
    if (/^\d|^\./.test(t)) {
      const n = Number(t);
      return () => n;
    }
    if (t === '(') {
      const f = sum();
      if (take() !== ')') fail("missing ')'");
      return f;
    }
    if (/^[a-z]+$/.test(t)) {
      if (FUNCS[t]) {
        // sin(t) takes its brackets (so sin(t)^2 squares the sine); written
        // without them, sin t, it takes the next term (sin t^2 = sin(t^2))
        const f = peek() === '(' ? atom() : power();
        const g = FUNCS[t];
        return (v) => g(f(v));
      }
      if (vars.includes(t)) return (v) => v[t];
      if (t in CONSTS) {
        const c = CONSTS[t];
        return () => c;
      }
      return fail(`unknown name '${t}' - use ${vars.join(', ')}, pi, e or a function like sin(...)`);
    }
    return fail(`unexpected '${t}'`);
  }

  const f = sum();
  if (i < toks.length) fail(`unexpected '${toks[i]}'`);
  return f;
}
