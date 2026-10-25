// Regenerates src/data/spectra.json: each element's visible emission lines,
// from the NIST Atomic Spectra Database.
//
//   node scripts/fetch-spectra.mjs
//
// Run by hand, like fetch-elements.mjs: the lines ship with the game and no
// player's browser ever calls NIST. For each element the neutral atom's
// spectrum (Ar I, Fe I...) is asked for between 380 and 750 nm, wavelengths in
// air. Only lines NIST lists as observed and with a relative intensity are
// kept, the strongest LINES_KEPT of them, intensity scaled so the strongest is
// 1. NIST's intensities come from different sources and are only comparable
// within one spectrum, which is all the ELEMENTS mode does with them.
// Elements with no such lines (most past uranium) are null: no data, not
// "no lines".
// Source: Kramida, A., Ralchenko, Yu., Reader, J. and NIST ASD Team, NIST
// Atomic Spectra Database, https://physics.nist.gov/asd
import { readFileSync, writeFileSync } from 'node:fs';

const LOW = 380;
const HIGH = 750;
const LINES_KEPT = 24;
const elements = JSON.parse(readFileSync(new URL('../src/data/elements.json', import.meta.url), 'utf8'));

function query(sym) {
  const p = new URLSearchParams({
    spectra: `${sym} I`,
    limits_type: '0',
    low_w: String(LOW),
    upp_w: String(HIGH),
    unit: '1', // nm
    format: '3', // tab-separated
    line_out: '0',
    remove_js: 'on',
    show_obs_wl: '1',
    // NIST refuses the query ("Invalid Column Setting") with this one off
    show_calc_wl: '1',
    intens_out: 'on',
    order_out: '0',
    en_unit: '0',
    output: '0', // everything on one page
    page_size: '15',
    show_av: '2', // air wavelengths
    A_out: '0',
    allowed_out: '1',
    forbid_out: '1',
  });
  return `https://physics.nist.gov/cgi-bin/ASD/lines1.pl?${p}`;
}

/** "1000", "200*", "50h", "(30)", "500bl" -> the number; "" -> null */
function intensity(s) {
  const m = /\d+(\.\d+)?/.exec(s);
  return m ? Number(m[0]) : null;
}

async function linesOf(sym) {
  const res = await fetch(query(sym));
  if (!res.ok) throw new Error(`${sym}: NIST answered ${res.status}`);
  const text = await res.text();
  // no lines in range: an HTML page that says so. Any other HTML page is an
  // error in the query and must not be read as "no lines".
  if (!text.startsWith('obs_wl')) {
    if (text.includes('No lines are available in ASD')) return null;
    throw new Error(`${sym}: NIST did not answer with lines: ${text.replace(/<[^>]*>|\s+/g, ' ').slice(0, 300)}`);
  }
  const rows = text.trim().split('\n');
  const head = rows[0].split('\t');
  const wl = head.findIndex((h) => h.startsWith('obs_wl'));
  const it = head.indexOf('intens');
  const lines = [];
  for (const row of rows.slice(1)) {
    const c = row.split('\t').map((v) => v.replace(/^="?|"/g, '').trim());
    const w = Number(c[wl]);
    const i = intensity(c[it] ?? '');
    if (c[wl] && Number.isFinite(w) && w >= LOW && w <= HIGH && i !== null && i > 0) lines.push([w, i]);
  }
  if (lines.length === 0) return null;
  // one entry per wavelength (NIST can list a blend twice), the strongest kept
  const byWl = new Map();
  for (const [w, i] of lines) {
    const k = w.toFixed(2);
    if (!byWl.has(k) || byWl.get(k) < i) byWl.set(k, i);
  }
  const top = [...byWl].sort((a, b) => b[1] - a[1]).slice(0, LINES_KEPT);
  const max = top[0][1];
  return top
    // two significant figures: weak lines stay above zero
    .map(([k, i]) => [Number(k), Number((i / max).toPrecision(2))])
    .sort((a, b) => a[0] - b[0]);
}

const out = {};
for (const e of elements) {
  let lines = null;
  for (let attempt = 0; ; attempt++) {
    try {
      lines = await linesOf(e.sym);
      break;
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  out[e.sym] = lines;
  console.log(`${e.z} ${e.sym}: ${lines ? lines.length + ' lines' : 'no data'}`);
  // be polite to NIST
  await new Promise((r) => setTimeout(r, 300));
}

const file = new URL('../src/data/spectra.json', import.meta.url);
const body = Object.entries(out)
  .map(([sym, lines]) => `${JSON.stringify(sym)}:${JSON.stringify(lines)}`)
  .join(',\n');
writeFileSync(file, `{${body}}\n`);
console.log(`wrote ${Object.values(out).filter(Boolean).length} of ${elements.length} spectra to ${file.pathname}`);
