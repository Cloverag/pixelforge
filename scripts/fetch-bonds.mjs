// Writes src/data/bonds.json: the two-element compounds PubChem has a record
// for, as the ELEMENTS mode's BOND view predicts them.
//
//   node scripts/fetch-bonds.mjs
//
// Run by hand, never at build or run time. For every pair of elements the
// formulas are predicted from PubChem's common oxidation states (the more
// electronegative element takes a negative state, the other a positive one:
// Na +1 with Cl -1 is NaCl, C +4 with O -2 is CO2), and each formula is kept
// only if PubChem has a compound with exactly that formula. An element with
// itself is kept only as the X2 molecule PubChem files under the element's
// own name (H2 is "Hydrogen"; C2, "Dicarbon", is not carbon's form).
//
// From each compound's PubChem record: its title, its CID, the order of the
// strongest bond between the two elements (0: none, or an ionic one) and the
// charge on each element's atoms. A record is left out if it is not a neutral
// molecule or salt with a name: charged (NH2-, azanide), a radical (NH,
// nitrene), a mixture (a title like "Hydride;molecular hydrogen;nickel"),
// untitled ("CID 101943068") or isotope-labelled (NaD for NaH); then the
// formula's next hits are tried, up to ten. About 3,000 lookups, four at a
// time: some fifteen minutes. Answers are cached in node_modules/.cache, so a stopped
// run picks up where it left off.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const API = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound';
const elements = JSON.parse(readFileSync(new URL('../src/data/elements.json', import.meta.url)));
const CACHE = new URL('../node_modules/.cache/fetch-bonds.json', import.meta.url);
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE)) : {};
const save = () => {
  mkdirSync(new URL('.', CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cache));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** GET as JSON; null on PubChem's "no hits"; waits and retries when it is busy */
async function get(url) {
  for (let tries = 0; ; tries++) {
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (res.ok) return res.json();
    if ((res.status === 503 || res.status === 429 || res.status >= 500) && tries < 8) {
      await sleep(2000 * (tries + 1));
      continue;
    }
    throw new Error(`${res.status} from ${url}`);
  }
}

const ox = (e) => (e.ox ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n !== 0);
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const NONMETALS = new Set(['Nonmetal', 'Halogen']);
// hydrogen comes after groups 13-15 in IUPAC's element sequence: CH4, NH3, but H2O, HCl
const BEFORE_H = new Set('B Al Ga In Tl C Si Ge Sn Pb N P As Sb Bi'.split(' '));
const part = (sym, n) => (n === 1 ? sym : sym + n);

/** every candidate: the pair's key (lower Z first), the formula as written, and for X2 the name it must be filed under */
const candidates = [];
for (const a of elements) {
  for (const b of elements) {
    if (a.z > b.z) continue;
    const key = `${a.sym}-${b.sym}`;
    if (a.z === b.z) {
      if (NONMETALS.has(a.block)) candidates.push({ key, f: a.sym + '2', title: a.name });
      continue;
    }
    if (a.en === null || b.en === null || a.en === b.en) continue;
    const [pos, neg] = a.en < b.en ? [a, b] : [b, a];
    for (const p of ox(pos).filter((x) => x > 0)) {
      for (const q of ox(neg).filter((x) => x < 0)) {
        const k = gcd(p, -q);
        const np = -q / k;
        const nn = p / k;
        const hLast = pos.sym === 'H' && BEFORE_H.has(neg.sym);
        const f = hLast ? part(neg.sym, nn) + part(pos.sym, np) : part(pos.sym, np) + part(neg.sym, nn);
        if (!candidates.some((c) => c.key === key && c.f === f)) candidates.push({ key, f });
      }
    }
  }
}
console.log(`${candidates.length} formulas to look up`);

/** four lookups at a time, each worker pausing between its own: under PubChem's five a second */
async function pool(items, fn) {
  const todo = [...items];
  let done = 0;
  await Promise.all(
    [0, 1, 2, 3].map(async () => {
      for (let x; (x = todo.shift()) !== undefined; ) {
        await sleep(600);
        await fn(x);
        if (++done % 100 === 0) {
          save();
          console.log(`  ${done} of ${items.length}`);
        }
      }
    }),
  );
  save();
}

const records = new Map();
/** records and titles, fifty at a time */
async function fetchRecords(cids) {
  const need = [...new Set(cids)].filter((id) => !records.has(id));
  for (let i = 0; i < need.length; i += 50) {
    const ids = need.slice(i, i + 50).join(',');
    const [full, props] = [await get(`${API}/cid/${ids}/JSON`), await get(`${API}/cid/${ids}/property/Title/JSON`)];
    const titles = new Map(props.PropertyTable.Properties.map((p) => [p.CID, p.Title]));
    for (const rec of full.PC_Compounds) records.set(rec.id.id.cid, { rec, title: titles.get(rec.id.id.cid) });
  }
}

/** why a record is not a compound to show, or null */
function notACompound(cid) {
  const { rec, title } = records.get(cid);
  if ((rec.charge ?? 0) !== 0) return 'charged';
  if (rec.atoms.radical?.length) return 'radical';
  if (rec.count?.isotope_atom) return 'isotope-labelled';
  if (title.includes(';')) return 'mixture';
  if (/^CID \d+$/.test(title)) return 'untitled';
  return null;
}

// 1. which formulas PubChem has: its first hit for each
const formulas = [...new Set(candidates.map((c) => c.f))];
await pool(
  formulas.filter((f) => !(f in cache)),
  async (f) => {
    const r = await get(`${API}/fastformula/${f}/cids/JSON`);
    cache[f] = r?.IdentifierList?.CID?.[0] ?? null;
  },
);
const found = formulas.filter((f) => cache[f]);
await fetchRecords(found.map((f) => cache[f]));

// 2. a first hit that is no compound to show: the formula's next hits, up to ten
const pick = new Map();
const firstMiss = {};
const retry = [];
for (const f of found) {
  const why = notACompound(cache[f]);
  if (why) {
    firstMiss[why] = (firstMiss[why] ?? 0) + 1;
    retry.push(f);
  } else pick.set(f, cache[f]);
}
await pool(
  retry.filter((f) => !(`next:${f}` in cache)),
  async (f) => {
    const r = await get(`${API}/fastformula/${f}/cids/JSON?MaxRecords=10`);
    cache[`next:${f}`] = r?.IdentifierList?.CID ?? [];
  },
);
await fetchRecords(retry.flatMap((f) => cache[`next:${f}`]));
for (const f of retry) {
  const cid = cache[`next:${f}`].find((id) => records.has(id) && !notACompound(id));
  if (cid) pick.set(f, cid);
}
console.log('first hits passed over:', firstMiss, `- ${retry.filter((f) => pick.has(f)).length} of ${retry.length} found a later hit`);

/** PubChem's bond orders: 1-4 are bonds of that order, 5 a dative bond (one pair), 7 an ionic bond */
const SHARED = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 1 };
const IONIC = 7;

const zOf = new Map(elements.map((e) => [e.sym, e.z]));
const bonds = {};
for (const c of candidates) {
  const cid = pick.get(c.f);
  if (!cid) continue;
  const { rec, title } = records.get(cid);
  if (c.title && title.toLowerCase() !== c.title.toLowerCase()) continue;
  const [sa, sb] = c.key.split('-');
  const [za, zb] = [zOf.get(sa), zOf.get(sb)];
  const el = rec.atoms.element;
  const charge = new Map((rec.atoms.charge ?? []).map((x) => [x.aid, x.value]));
  const aids = rec.atoms.aid;
  const zAt = new Map(aids.map((aid, i) => [aid, el[i]]));
  // the strongest shared bond joining the two elements (any bond, for an element with itself);
  // an ionic bond (PubChem's order 7) counts as none, its charges say the rest
  let order = 0;
  const bs = rec.bonds ?? { aid1: [], aid2: [], order: [] };
  bs.aid1.forEach((a1, i) => {
    const pair = [zAt.get(a1), zAt.get(bs.aid2[i])].sort((x, y) => x - y).join('-');
    if (pair === `${za}-${zb}` && bs.order[i] !== IONIC) order = Math.max(order, SHARED[bs.order[i]] ?? 0);
  });
  const qOf = (z) => charge.get(aids[el.indexOf(z)]) ?? 0;
  (bonds[c.key] ??= []).push({ f: c.f, name: title, cid, o: order, q: [qOf(za), qOf(zb)] });
}

const out = new URL('../src/data/bonds.json', import.meta.url);
writeFileSync(out, JSON.stringify(bonds).replace(/\],"/g, '],\n"') + '\n');
const n = Object.values(bonds).reduce((s, l) => s + l.length, 0);
console.log(`wrote ${n} compounds for ${Object.keys(bonds).length} pairs to ${out.pathname}`);
