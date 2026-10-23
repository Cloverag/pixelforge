// Regenerates src/data/elements.json from PubChem's periodic table.
//
//   node scripts/fetch-elements.mjs
//
// Run by hand when the data should be refreshed, never at build or run time:
// the game is a static site, so the element table ships with it and no
// player's browser ever calls PubChem. Only the fields the CHEM LAB shows are
// kept. Source: https://pubchem.ncbi.nlm.nih.gov/periodic-table/ (NCBI).
import { writeFileSync } from 'node:fs';

const SOURCE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/JSON';

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`PubChem answered ${res.status}`);
const { Table } = await res.json();
const col = Object.fromEntries(Table.Columns.Column.map((name, i) => [name, i]));
const num = (s) => (s === '' ? null : Number(s));

const elements = Table.Row.map(({ Cell: c }) => ({
  z: Number(c[col.AtomicNumber]),
  sym: c[col.Symbol],
  name: c[col.Name],
  mass: num(c[col.AtomicMass]),
  cpk: c[col.CPKHexColor] || null,
  state: c[col.StandardState] || null,
  melt: num(c[col.MeltingPoint]),
  boil: num(c[col.BoilingPoint]),
  block: c[col.GroupBlock],
}));
if (elements.length !== 118) throw new Error(`expected 118 elements, got ${elements.length}`);

const out = new URL('../src/data/elements.json', import.meta.url);
writeFileSync(out, JSON.stringify(elements, null, 0).replace(/\},\{/g, '},\n{') + '\n');
console.log(`wrote ${elements.length} elements to ${out.pathname}`);
