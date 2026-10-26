/**
 * A small formula reader for MATH LAB's YOUR CURVE: what a player types,
 * like `1 + 2cos(5t)` or `exp(sin(t)) - 2cos(4t)`, turned into a function.
 * Never `eval`: the text is parsed into a tree of plain operations, so
 * nothing typed can run as code. The same tree is written out as TeX, so
 * the panel shows the formula typeset the way a book would print it.
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

/** What a formula is made of. `imp` is two things written side by side (2t). */
export type Node =
  | { k: 'num'; v: number; src: string }
  | { k: 'name'; n: string }
  | { k: 'const'; n: string }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^' | 'imp'; a: Node; b: Node }
  | { k: 'fn'; n: string; a: Node; paren: boolean };

type Fn = (v: Record<string, number>) => number;

/**
 * Read `src` into a tree. Throws an Error with a message a player can act
 * on ("unknown name 'x'", "missing ')'").
 */
export function parse(src: string, vars: string[]): Node {
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

  function sum(): Node {
    let n = product();
    while (peek() === '+' || peek() === '-') {
      const op = take() as '+' | '-';
      n = { k: 'bin', op, a: n, b: product() };
    }
    return n;
  }
  function product(): Node {
    let n = unary();
    for (;;) {
      const t = peek();
      if (t === '*' || t === '/') {
        take();
        n = { k: 'bin', op: t, a: n, b: unary() };
      } else if (t !== undefined && (/^[a-z(]/.test(t) || /^\d|^\./.test(t))) {
        // written side by side: 2t, 3sin(t), (t)(t)
        n = { k: 'bin', op: 'imp', a: n, b: power() };
      } else return n;
    }
  }
  function power(): Node {
    const base = atom();
    if (peek() !== '^') return base;
    take();
    return { k: 'bin', op: '^', a: base, b: unary() };
  }
  function unary(): Node {
    if (peek() === '-') {
      take();
      return { k: 'neg', a: unary() };
    }
    if (peek() === '+') {
      take();
      return unary();
    }
    return power();
  }
  function atom(): Node {
    const t = take();
    if (t === undefined) return fail('the formula ends too soon');
    if (/^\d|^\./.test(t)) return { k: 'num', v: Number(t), src: t };
    if (t === '(') {
      const n = sum();
      if (take() !== ')') fail("missing ')'");
      return n;
    }
    if (/^[a-z]+$/.test(t)) {
      if (FUNCS[t]) {
        // sin(t) takes its brackets (so sin(t)^2 squares the sine); written
        // without them, sin t, it takes the next term (sin t^2 = sin(t^2))
        const paren = peek() === '(';
        return { k: 'fn', n: t, a: paren ? atom() : power(), paren };
      }
      if (vars.includes(t)) return { k: 'name', n: t };
      if (t in CONSTS) return { k: 'const', n: t };
      return fail(`unknown name '${t}' - use ${vars.join(', ')}, pi, e or a function like sin(...)`);
    }
    return fail(`unexpected '${t}'`);
  }

  const n = sum();
  if (i < toks.length) fail(`unexpected '${toks[i]}'`);
  return n;
}

/** The tree as a function of the named variables. */
function evaluate(n: Node): Fn {
  switch (n.k) {
    case 'num': {
      const c = n.v;
      return () => c;
    }
    case 'const': {
      const c = CONSTS[n.n];
      return () => c;
    }
    case 'name': {
      const name = n.n;
      return (v) => v[name];
    }
    case 'neg': {
      const a = evaluate(n.a);
      return (v) => -a(v);
    }
    case 'fn': {
      const g = FUNCS[n.n];
      const a = evaluate(n.a);
      return (v) => g(a(v));
    }
    case 'bin': {
      const a = evaluate(n.a);
      const b = evaluate(n.b);
      switch (n.op) {
        case '+': return (v) => a(v) + b(v);
        case '-': return (v) => a(v) - b(v);
        case '/': return (v) => a(v) / b(v);
        case '^': return (v) => Math.pow(a(v), b(v));
        default: return (v) => a(v) * b(v);
      }
    }
  }
}

/**
 * Compile `src` into a function of the named variables. Throws an Error with
 * a message a player can act on ("unknown name 'x'", "missing ')'").
 */
export function compile(src: string, vars: string[]): Fn {
  return evaluate(parse(src, vars));
}

/* ------------------------------------------------------------------ TeX */

const TEX_FN: Record<string, string> = {
  sin: '\\sin', cos: '\\cos', tan: '\\tan', asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan',
  exp: '\\exp', ln: '\\ln', log: '\\log_{10}', sign: '\\operatorname{sign}',
};

/** how tightly each kind of node binds: a child looser than its place gets brackets */
const LEVEL = { sum: 1, product: 2, neg: 3, power: 4, atom: 5 } as const;
function level(n: Node): number {
  if (n.k === 'bin') return n.op === '+' || n.op === '-' ? LEVEL.sum : n.op === '^' ? LEVEL.power : n.op === '/' ? LEVEL.atom : LEVEL.product;
  if (n.k === 'neg') return LEVEL.neg;
  // sin x^2 is printed sin(x^2): a function reads as a product's factor
  if (n.k === 'fn') return n.n === 'sqrt' || n.n === 'abs' || n.n === 'floor' ? LEVEL.atom : LEVEL.product;
  return LEVEL.atom;
}
const paren = (s: string) => `\\left(${s}\\right)`;

/** A function: sqrt and |x| drawn; sin t bare when its argument is one letter or number, unless `wrap`. */
/** One letter or number: sin t needs no brackets round it. */
const simple = (n: Node) => n.k === 'name' || n.k === 'const' || n.k === 'num';

/**
 * The tree in TeX: fractions stacked, powers raised, sqrt and |x| drawn.
 * `tight`: a factor follows this one in a product, so a function at its end
 * keeps its brackets (sin(t) 2, never sin t 2, which reads as sin(2t)).
 */
export function nodeTex(n: Node, tight = false): string {
  const at = (c: Node, min: number, t = false) => (level(c) < min ? paren(nodeTex(c)) : nodeTex(c, t));
  switch (n.k) {
    case 'num':
      return n.src.startsWith('.') ? `0${n.src}` : n.src;
    case 'name':
      return n.n;
    case 'const':
      return n.n === 'pi' ? '\\pi' : n.n;
    case 'neg':
      return `-${at(n.a, LEVEL.neg, tight)}`;
    case 'fn': {
      if (n.n === 'sqrt') return `\\sqrt{${nodeTex(n.a)}}`;
      if (n.n === 'abs') return `\\left|${nodeTex(n.a)}\\right|`;
      if (n.n === 'floor') return `\\left\\lfloor ${nodeTex(n.a)}\\right\\rfloor`;
      // exp(x) is printed as e raised to x
      if (n.n === 'exp') return `e^{${nodeTex(n.a)}}`;
      return `${TEX_FN[n.n]}${!tight && simple(n.a) ? ` ${nodeTex(n.a)}` : paren(nodeTex(n.a))}`;
    }
    case 'bin': {
      const { op, a, b } = n;
      if (op === '/') return `\\frac{${nodeTex(a)}}{${nodeTex(b)}}`;
      if (op === '^') {
        // sin(t)^2 is written sin^2 t, the way it is printed
        if (a.k === 'fn' && a.paren && a.n in TEX_FN && a.n !== 'exp' && a.n !== 'log' && b.k === 'num') {
          const inner = !tight && simple(a.a) ? ` ${nodeTex(a.a)}` : paren(nodeTex(a.a));
          return `${TEX_FN[a.n]}^{${nodeTex(b)}}${inner}`;
        }
        return `{${at(a, LEVEL.atom)}}^{${nodeTex(b)}}`;
      }
      if (op === '+') return `${nodeTex(a)} + ${at(b, LEVEL.sum)}`;
      // a - (b + c) keeps its brackets; a - b - c reads left to right
      if (op === '-') return `${nodeTex(a)} - ${at(b, LEVEL.product)}`;
      // a product: the left side is followed by the right, so it is tight;
      // a function on the right (2 cos 5t) needs no brackets round it
      const left = at(a, LEVEL.product, true);
      const right = b.k === 'fn' ? nodeTex(b, tight) : at(b, LEVEL.neg + 1, tight);
      // a number after anything needs a visible times: 2 \cdot 3, t \cdot 2
      const dot = b.k === 'num' || b.k === 'neg' ? ' \\cdot ' : ' ';
      return `${left}${dot}${right}`;
    }
  }
}

/** What the player typed, typeset. Throws as `compile` does. */
export function toTex(src: string, vars: string[]): string {
  return nodeTex(parse(src, vars));
}
