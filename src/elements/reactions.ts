import { bondKind, chargeMark, ionCharges, ordered, subscript, type BondElement, type Compound } from './bond';

/**
 * The ELEMENTS mode's REACTIONS: a searchable list of balanced equations,
 * each with how it happens, step by step, and what its products go on to
 * react with. Pure: the screen draws it.
 *
 * Two kinds:
 * - FAMOUS: well-known reactions (burning, water and the alkali metals,
 *   thermite, the Haber process...), written here with a few steps each in
 *   words, no figures.
 * - FORMATION: every compound in data/bonds.json made from its elements,
 *   balanced by code (2Na + Cl2 -> 2NaCl), its steps worked out from
 *   PubChem's numbers: the ionization energy and electron affinity behind an
 *   ionic bond, the bond order behind a covalent one.
 *
 * Every equation is checked to balance (tests/reactions.test.ts).
 */

export interface Species {
  /** the coefficient */
  n: number;
  /** the formula as written: Ca(OH)2, CH3COOH */
  f: string;
}

export type ReactionKind =
  | 'COMBUSTION'
  | 'SYNTHESIS'
  | 'DECOMPOSITION'
  | 'SINGLE DISPLACEMENT'
  | 'DOUBLE DISPLACEMENT'
  | 'NEUTRALISATION'
  | 'FORMATION';

/** when a step happens in the bond view's picture: before anything moves, while electrons move, once the bond is made */
export type Phase = 'before' | 'moving' | 'made';

export interface Step {
  text: string;
  phase?: Phase;
}

/** what CHEM LAB can show of a reaction: an experiment to load, and what to paint */
export interface LabTry {
  scene?: 'alkali' | 'thermite';
  hint: string;
}

export interface Reaction {
  id: string;
  name: string;
  kind: ReactionKind;
  left: Species[];
  right: Species[];
  /** the bond the 3D view plays for it: two symbols and, if one is on record, the compound */
  show: [string, string, string | null];
  steps: Step[];
  lab?: LabTry;
}

// ---- formulas ----

/** "Ca(OH)2" -> { Ca: 1, O: 2, H: 2 } */
export function parseFormula(f: string): Record<string, number> {
  const stack: Record<string, number>[] = [{}];
  let i = 0;
  const num = () => {
    const m = /^\d+/.exec(f.slice(i));
    if (!m) return 1;
    i += m[0].length;
    return Number(m[0]);
  };
  while (i < f.length) {
    const ch = f[i];
    if (ch === '(') {
      stack.push({});
      i++;
    } else if (ch === ')') {
      i++;
      const k = num();
      const group = stack.pop()!;
      const top = stack[stack.length - 1];
      for (const [el, n] of Object.entries(group)) top[el] = (top[el] ?? 0) + n * k;
    } else {
      const m = /^[A-Z][a-z]?/.exec(f.slice(i));
      if (!m) throw new Error(`bad formula ${f} at ${i}`);
      i += m[0].length;
      const top = stack[stack.length - 1];
      top[m[0]] = (top[m[0]] ?? 0) + num();
    }
  }
  if (stack.length !== 1) throw new Error(`unbalanced brackets in ${f}`);
  return stack[0];
}

/** "2Na + Cl2 -> 2NaCl" -> each side's species */
export function parseEquation(eq: string): { left: Species[]; right: Species[] } {
  const side = (s: string) =>
    s.split(' + ').map((t) => {
      const m = /^(\d*)\s*(\S+)$/.exec(t.trim());
      if (!m) throw new Error(`bad species ${t}`);
      return { n: m[1] ? Number(m[1]) : 1, f: m[2] };
    });
  const [l, r] = eq.split(' -> ');
  return { left: side(l), right: side(r) };
}

/** every element's count on one side */
export function atomsOf(side: Species[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of side) for (const [el, n] of Object.entries(parseFormula(s.f))) out[el] = (out[el] ?? 0) + n * s.n;
  return out;
}

export function balanced(r: Pick<Reaction, 'left' | 'right'>): boolean {
  const a = atomsOf(r.left);
  const b = atomsOf(r.right);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => a[k] === b[k]);
}

/** "2 Na + Cl₂ → 2 NaCl" */
export function equationText(r: Pick<Reaction, 'left' | 'right'>): string {
  const side = (s: Species[]) => s.map((x) => `${x.n > 1 ? x.n + ' ' : ''}${subscript(x.f)}`).join(' + ');
  return `${side(r.left)} → ${side(r.right)}`;
}

// ---- the famous ones ----

const PAINT = (what: string): LabTry => ({ hint: what });

/** [id, name, kind, equation, the bond to show, steps, CHEM LAB] */
const FAMOUS_SRC: [string, string, ReactionKind, string, Reaction['show'], string[], LabTry?][] = [
  ['h2-burn', 'Hydrogen burns', 'COMBUSTION', '2H2 + O2 -> 2H2O', ['H', 'O', 'H2O'], [
    'A spark breaks a few H–H and O=O bonds, freeing reactive atoms.',
    'Each freed atom breaks another molecule apart and frees more: a chain that runs away as an explosion.',
    'Each oxygen ends up sharing a pair with each of two hydrogens: water.',
    'Far more energy comes out forming the O–H bonds than went into breaking H–H and O=O: heat and light.',
  ], PAINT('PAINT HYDROGEN AND OXYGEN, THEN ADD FIRE')],
  ['ch4-burn', 'Methane burns (natural gas)', 'COMBUSTION', 'CH4 + 2O2 -> CO2 + 2H2O', ['C', 'O', 'CO2'], [
    'Heat breaks the first C–H bonds, and oxygen takes the hydrogen.',
    'The carbon ends up double-bonded to two oxygens: carbon dioxide.',
    'The hydrogens end up bonded to oxygen: water.',
    'The new C=O and O–H bonds hold more tightly than the old ones: the difference comes out as heat.',
  ]],
  ['c-burn', 'Charcoal burns', 'COMBUSTION', 'C + O2 -> CO2', ['C', 'O', 'CO2'], [
    'Heat lets oxygen molecules react at the charcoal’s surface.',
    'Each carbon atom takes two oxygens, double-bonded: carbon dioxide.',
    'The heat given out keeps the next layer of charcoal burning.',
  ]],
  ['c-co', 'Charcoal burns short of air', 'COMBUSTION', '2C + O2 -> 2CO', ['C', 'O', 'CO'], [
    'With too little oxygen, each carbon atom takes only one.',
    'Carbon and oxygen share three pairs: carbon monoxide, a colourless, poisonous gas.',
    'Given more oxygen, it burns on to carbon dioxide.',
  ]],
  ['co-burn', 'Carbon monoxide burns', 'COMBUSTION', '2CO + O2 -> 2CO2', ['C', 'O', 'CO2'], [
    'Each carbon monoxide molecule takes one more oxygen atom.',
    'The C≡O triple bond gives way to two C=O double bonds: carbon dioxide.',
    'It burns with a blue flame.',
  ]],
  ['propane-burn', 'Propane burns (camping gas)', 'COMBUSTION', 'C3H8 + 5O2 -> 3CO2 + 4H2O', ['C', 'O', 'CO2'], [
    'Heat starts breaking its C–H and C–C bonds.',
    'Every carbon ends up in carbon dioxide, every hydrogen in water.',
    'The heat given out is what camping stoves and gas grills run on.',
  ]],
  ['ethanol-burn', 'Ethanol burns', 'COMBUSTION', 'C2H5OH + 3O2 -> 2CO2 + 3H2O', ['C', 'O', 'CO2'], [
    'Heat breaks the alcohol’s bonds, and oxygen takes up its carbon and hydrogen.',
    'Carbon dioxide and water form, with a pale blue flame.',
  ]],
  ['respiration', 'Respiration (glucose)', 'COMBUSTION', 'C6H12O6 + 6O2 -> 6CO2 + 6H2O', ['C', 'O', 'CO2'], [
    'In living cells, enzymes take glucose apart in many small steps: no flame.',
    'Its carbon leaves as carbon dioxide, which you breathe out; its hydrogen ends up in water.',
    'Much of the energy is caught in ATP, the cell’s energy carrier; the rest warms the body.',
  ]],
  ['photosynthesis', 'Photosynthesis', 'SYNTHESIS', '6CO2 + 6H2O -> C6H12O6 + 6O2', ['H', 'O', 'H2O'], [
    'Chlorophyll in a leaf absorbs light.',
    'The light’s energy splits water; its oxygen is given off as O₂.',
    'The hydrogen and the energy build carbon dioxide into glucose.',
  ]],
  ['na-cl2', 'Sodium burns in chlorine', 'SYNTHESIS', '2Na + Cl2 -> 2NaCl', ['Na', 'Cl', 'NaCl'], [
    'Chlorine molecules split into atoms.',
    'Each sodium atom hands its single outer electron to a chlorine atom.',
    'Na⁺ and Cl⁻ hold together by their opposite charges: table salt, with a bright yellow flame.',
  ], PAINT('PAINT SODIUM NEXT TO CHLORINE')],
  ['na-o2', 'Sodium tarnishes in air', 'SYNTHESIS', '4Na + O2 -> 2Na2O', ['Na', 'O', 'Na2O'], [
    'Freshly cut sodium stays shiny for only moments.',
    'Each oxygen atom takes one electron from each of two sodium atoms.',
    'A dull layer of sodium oxide covers it: why sodium is kept under oil.',
  ]],
  ['li-water', 'Lithium in water', 'SINGLE DISPLACEMENT', '2Li + 2H2O -> 2LiOH + H2', ['H', 'H', 'H2'], [
    'Lithium holds its outer electron more tightly than sodium: it fizzes steadily without melting.',
    'Water takes the electron and splits: hydroxide stays in the water, hydrogen pairs up as H₂ and bubbles off.',
    'The water turns to lithium hydroxide.',
  ], { scene: 'alkali', hint: 'THE ALKALI BATH: LITHIUM, SODIUM, POTASSIUM' }],
  ['na-water', 'Sodium in water', 'SINGLE DISPLACEMENT', '2Na + 2H2O -> 2NaOH + H2', ['H', 'H', 'H2'], [
    'Each sodium atom gives its outer electron to water.',
    'Water splits: hydroxide ions (OH⁻) stay in the water, hydrogen atoms pair up as H₂ gas.',
    'The heat melts the sodium into a ball that fizzes across the surface; the water turns to lye.',
  ], { scene: 'alkali', hint: 'THE ALKALI BATH: LITHIUM, SODIUM, POTASSIUM' }],
  ['k-water', 'Potassium in water', 'SINGLE DISPLACEMENT', '2K + 2H2O -> 2KOH + H2', ['H', 'H', 'H2'], [
    'Potassium gives up its outer electron even more easily than sodium.',
    'The hydrogen forms so fast and so hot that it catches fire: a lilac flame.',
    'The water turns to potassium hydroxide.',
  ], { scene: 'alkali', hint: 'THE ALKALI BATH: LITHIUM, SODIUM, POTASSIUM' }],
  ['cs-water', 'Caesium in water', 'SINGLE DISPLACEMENT', '2Cs + 2H2O -> 2CsOH + H2', ['H', 'H', 'H2'], [
    'Caesium’s outer electron is the most loosely held of any stable element’s.',
    'It reacts explosively the instant it touches water.',
  ], PAINT('PAINT CAESIUM INTO WATER')],
  ['ca-water', 'Calcium in water', 'SINGLE DISPLACEMENT', 'Ca + 2H2O -> Ca(OH)2 + H2', ['H', 'H', 'H2'], [
    'Calcium gives two electrons to water, more slowly than the alkali metals.',
    'Hydrogen bubbles off, and calcium hydroxide clouds the water.',
  ]],
  ['mg-burn', 'Magnesium burns', 'COMBUSTION', '2Mg + O2 -> 2MgO', ['Mg', 'O', 'MgO'], [
    'Once lit, each magnesium atom gives two electrons to an oxygen atom.',
    'Mg²⁺ and O²⁻ ions pack into white magnesium oxide powder.',
    'It burns with a blinding white light, once used for camera flashes.',
  ], PAINT('PAINT MAGNESIUM, THEN ADD FIRE')],
  ['rust', 'Iron rusts (simplified)', 'SYNTHESIS', '4Fe + 3O2 -> 2Fe2O3', ['Fe', 'O', 'Fe2O3'], [
    'Water on the iron lets electrons leave the metal: iron turns to Fe²⁺, then Fe³⁺.',
    'Oxygen dissolved in the water takes those electrons.',
    'Iron(III) oxide builds up as rust. Real rust also holds water, which this equation leaves out.',
  ], PAINT('PAINT IRON INTO WATER AND WAIT')],
  ['thermite', 'Thermite', 'SINGLE DISPLACEMENT', 'Fe2O3 + 2Al -> Al2O3 + 2Fe', ['Al', 'O', 'Al2O3'], [
    'Aluminium holds on to oxygen far more tightly than iron does.',
    'Once lit, which takes a very hot start, aluminium takes the oxygen from the iron oxide.',
    'So much heat comes out that the iron is left molten: it is used to weld rails.',
  ], { scene: 'thermite', hint: 'THERMITE: A MAGNESIUM RIBBON LIGHTS IT' }],
  ['haber', 'Ammonia (the Haber process)', 'SYNTHESIS', 'N2 + 3H2 -> 2NH3', ['N', 'H', 'NH3'], [
    'Nitrogen’s triple bond is one of the strongest there is: an iron catalyst helps break it.',
    'Each nitrogen atom takes three hydrogens: ammonia.',
    'High pressure pushes the balance toward ammonia. Most fertiliser starts here.',
  ]],
  ['h2-cl2', 'Hydrogen and chlorine', 'SYNTHESIS', 'H2 + Cl2 -> 2HCl', ['H', 'Cl', 'HCl'], [
    'Light or heat splits a chlorine molecule into atoms.',
    'A chain: a Cl atom takes an H from H₂, the freed H takes a Cl from Cl₂, and so on.',
    'Hydrogen chloride forms; dissolved in water, it is hydrochloric acid.',
  ], PAINT('PAINT HYDROGEN AND CHLORINE, THEN ADD FIRE')],
  ['h2-f2', 'Hydrogen and fluorine', 'SYNTHESIS', 'H2 + F2 -> 2HF', ['H', 'F', 'HF'], [
    'Fluorine is the most electronegative element: it reacts with hydrogen even cold and in the dark.',
    'Hydrogen fluoride forms, with a violent release of heat.',
  ], PAINT('PAINT FLUORINE NEXT TO HYDROGEN')],
  ['neutralise', 'Acid meets base', 'NEUTRALISATION', 'HCl + NaOH -> NaCl + H2O', ['H', 'O', 'H2O'], [
    'In water both come apart into ions: H⁺ and Cl⁻, Na⁺ and OH⁻.',
    'Each H⁺ joins an OH⁻: water.',
    'Na⁺ and Cl⁻ stay dissolved: salt water, a little warmer than before.',
  ], PAINT('PAINT ACID NEXT TO LYE')],
  ['h2so4-naoh', 'Sulfuric acid meets lye', 'NEUTRALISATION', 'H2SO4 + 2NaOH -> Na2SO4 + 2H2O', ['H', 'O', 'H2O'], [
    'Each sulfuric acid molecule gives up two H⁺ ions.',
    'Each H⁺ joins an OH⁻ from the lye: water.',
    'Sodium sulfate stays dissolved.',
  ]],
  ['limestone', 'Limestone in a kiln', 'DECOMPOSITION', 'CaCO3 -> CaO + CO2', ['Ca', 'O', 'CaO'], [
    'Heated strongly, limestone breaks apart.',
    'Carbon dioxide escapes as a gas.',
    'Quicklime, calcium oxide, is left: a start for cement and mortar.',
  ]],
  ['slaking', 'Slaking lime', 'SYNTHESIS', 'CaO + H2O -> Ca(OH)2', ['Ca', 'O', 'CaO'], [
    'Water reacts with quicklime, giving out a lot of heat.',
    'Slaked lime, calcium hydroxide, forms: used in mortar and plaster.',
  ]],
  ['chalk-acid', 'Chalk in acid', 'DOUBLE DISPLACEMENT', 'CaCO3 + 2HCl -> CaCl2 + H2O + CO2', ['Ca', 'Cl', 'CaCl2'], [
    'The acid’s H⁺ ions attack the carbonate.',
    'Carbonic acid forms and at once breaks up into water and carbon dioxide: the fizz.',
    'Calcium chloride stays dissolved.',
  ]],
  ['baking-soda', 'Baking soda and vinegar', 'DOUBLE DISPLACEMENT', 'NaHCO3 + CH3COOH -> CH3COONa + H2O + CO2', ['C', 'O', 'CO2'], [
    'The vinegar’s acid gives an H⁺ to the bicarbonate.',
    'Carbonic acid forms and at once splits into water and carbon dioxide: the foam.',
    'Sodium acetate stays dissolved.',
  ]],
  ['zn-hcl', 'Zinc in acid', 'SINGLE DISPLACEMENT', 'Zn + 2HCl -> ZnCl2 + H2', ['Zn', 'Cl', 'ZnCl2'], [
    'Each zinc atom gives two electrons to two H⁺ ions from the acid.',
    'The hydrogen atoms pair up and bubble off as H₂.',
    'Zinc chloride stays dissolved.',
  ]],
  ['mg-hcl', 'Magnesium in acid', 'SINGLE DISPLACEMENT', 'Mg + 2HCl -> MgCl2 + H2', ['Mg', 'Cl', 'MgCl2'], [
    'Magnesium gives up its two outer electrons faster than zinc does: it fizzes hard.',
    'Hydrogen bubbles off; magnesium chloride stays dissolved.',
  ]],
  ['h2o2', 'Hydrogen peroxide breaks down', 'DECOMPOSITION', '2H2O2 -> 2H2O + O2', ['O', 'O', 'O2'], [
    'Hydrogen peroxide’s weak O–O bond breaks easily, faster with a catalyst such as yeast.',
    'Water and oxygen gas form: the oxygen makes the foam.',
  ]],
  ['electrolysis-water', 'Splitting water with electricity', 'DECOMPOSITION', '2H2O -> 2H2 + O2', ['H', 'H', 'H2'], [
    'A current pushes electrons in at one electrode and draws them out at the other.',
    'At the negative electrode water gains electrons: hydrogen bubbles off.',
    'At the positive one it loses them: oxygen bubbles off, half as much by volume.',
  ]],
  ['electrolysis-salt', 'Splitting molten salt', 'DECOMPOSITION', '2NaCl -> 2Na + Cl2', ['Cl', 'Cl', 'Cl2'], [
    'Salt is melted so its ions can move.',
    'At the negative electrode each Na⁺ takes back an electron: liquid sodium.',
    'At the positive one each Cl⁻ gives one up, and the atoms pair up as chlorine gas.',
  ]],
  ['fe-s', 'Iron and sulfur', 'SYNTHESIS', 'Fe + S -> FeS', ['Fe', 'S', 'FeS'], [
    'Heated together, iron and sulfur react, glowing once started.',
    'Iron(II) sulfide forms: a black solid a magnet no longer picks out.',
  ]],
  ['hg-s', 'Mercury and sulfur', 'SYNTHESIS', 'Hg + S -> HgS', ['Hg', 'S', 'HgS'], [
    'Sulfur powder reacts with mercury even at room temperature.',
    'Mercury sulfide forms and holds the mercury so it cannot evaporate: why sulfur goes on mercury spills.',
  ], PAINT('PAINT SULFUR ON MERCURY')],
  ['s-burn', 'Sulfur burns', 'COMBUSTION', 'S + O2 -> SO2', ['S', 'O', 'SO2'], [
    'Sulfur burns with a blue flame.',
    'Sulfur dioxide forms: a choking gas, and one cause of acid rain.',
  ]],
  ['contact', 'Sulfur trioxide (the contact process)', 'SYNTHESIS', '2SO2 + O2 -> 2SO3', ['S', 'O', 'SO3'], [
    'A vanadium oxide catalyst lets sulfur dioxide take one more oxygen.',
    'Sulfur trioxide forms: the key step in making sulfuric acid.',
  ]],
  ['so3-water', 'Sulfuric acid', 'SYNTHESIS', 'SO3 + H2O -> H2SO4', ['S', 'O', 'SO3'], [
    'Sulfur trioxide reacts violently with water.',
    'Sulfuric acid forms. In industry the SO₃ is first taken up in sulfuric acid, to tame the heat.',
  ]],
  ['carbonic', 'Carbon dioxide in water', 'SYNTHESIS', 'CO2 + H2O -> H2CO3', ['C', 'O', 'CO2'], [
    'A little of the carbon dioxide dissolved in water reacts with it.',
    'Carbonic acid forms: a weak acid, the tang of fizzy drinks.',
  ]],
  ['silver-chloride', 'Silver chloride drops out', 'DOUBLE DISPLACEMENT', 'AgNO3 + NaCl -> AgCl + NaNO3', ['Ag', 'Cl', 'AgCl'], [
    'Both dissolve into ions: Ag⁺ and NO₃⁻, Na⁺ and Cl⁻.',
    'Ag⁺ meets Cl⁻, and silver chloride, which does not dissolve, drops out as a white solid.',
    'Na⁺ and NO₃⁻ stay dissolved.',
  ]],
  ['cu-ag', 'Copper in silver nitrate', 'SINGLE DISPLACEMENT', 'Cu + 2AgNO3 -> Cu(NO3)2 + 2Ag', ['Cu', 'Ag', null], [
    'Copper holds its electrons less tightly than silver: it gives them to the silver ions.',
    'Silver crystals grow on the copper, and Cu²⁺ ions turn the solution blue.',
  ]],
  ['fe-cu', 'Iron in copper sulfate', 'SINGLE DISPLACEMENT', 'Fe + CuSO4 -> FeSO4 + Cu', ['Fe', 'Cu', null], [
    'Iron gives two electrons to each copper ion.',
    'Copper coats the iron red-brown, and the blue solution fades toward pale green.',
  ]],
  ['kclo3', 'Oxygen from potassium chlorate', 'DECOMPOSITION', '2KClO3 -> 2KCl + 3O2', ['K', 'Cl', 'KCl'], [
    'Heated, potassium chlorate gives off oxygen, faster with a manganese dioxide catalyst.',
    'Potassium chloride is left.',
  ]],
  ['ostwald', 'Ammonia burns on platinum (the Ostwald process)', 'COMBUSTION', '4NH3 + 5O2 -> 4NO + 6H2O', ['H', 'O', 'H2O'], [
    'Ammonia and air pass over hot platinum gauze.',
    'Nitrogen monoxide and water form: the first step toward nitric acid.',
  ]],
];

export const FAMOUS: Reaction[] = FAMOUS_SRC.map(([id, name, kind, eq, show, steps, lab]) => ({
  id,
  name,
  kind,
  ...parseEquation(eq),
  show,
  steps: steps.map((text) => ({ text })),
  lab,
}));

// ---- formation from the elements ----

/** what PubChem's numbers add to the formation steps */
export interface StepElement extends BondElement {
  ie: number | null;
  ea: number | null;
}

/** the elements that are two-atom molecules as they come: H2, N2, O2 and the halogens */
const DIATOMIC = new Set(['H', 'N', 'O', 'F', 'Cl', 'Br', 'I']);
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const BOND_WORD = ['', 'single', 'double', 'triple'];
const electrons = (n: number) => (n === 1 ? 'electron' : 'electrons');

/**
 * A compound made from its elements, balanced: each element as it comes
 * (H2, Cl2; Na, Fe as atoms), the smallest whole numbers that match.
 */
export function formationOf(c: Compound, a: StepElement, b: StepElement): Reaction {
  const n = parseFormula(c.f);
  // per unit of the compound, each element's atoms (half as many molecules if diatomic), in the formula's order
  const need = Object.keys(n).map((sym) => {
    const e = sym === a.sym ? a : b;
    return { e, atoms: n[sym], two: DIATOMIC.has(sym) };
  });
  // the smallest k such that k * atoms / 2 is whole for every diatomic
  const k = need.some((x) => x.two && x.atoms % 2 === 1) ? 2 : 1;
  const left = need.map((x) => ({ n: (k * x.atoms) / (x.two ? 2 : 1), f: x.two ? `${x.e.sym}2` : x.e.sym }));
  const g = left.reduce((acc, s) => gcd(acc, s.n), k);
  const r: Reaction = {
    id: `f-${c.cid}`,
    name: c.name,
    kind: 'FORMATION',
    left: left.map((s) => ({ ...s, n: s.n / g })),
    right: [{ n: k / g, f: c.f }],
    show: [a.sym, b.sym, c.f],
    steps: [],
  };
  r.steps = formationSteps(c, a, b, r);
  return r;
}

/** How a formation happens, from PubChem's numbers: what breaks, what moves, what holds. */
export function formationSteps(c: Compound, a: StepElement, b: StepElement, r: Pick<Reaction, 'left'>): Step[] {
  const [left, right] = ordered(a, b);
  const kind = bondKind(left, right);
  const steps: Step[] = [];
  const twos = r.left.filter((s) => s.f.endsWith('2'));
  if (twos.length) {
    steps.push({
      phase: 'before',
      text: twos
        .map((s) => {
          const x = s.f.slice(0, -1);
          return `${subscript(s.f)} splits into atoms: its ${x}–${x} bond breaks.`;
        })
        .join(' '),
    });
  }
  const n = parseFormula(c.f);
  if (kind === 'ionic') {
    const q = ionCharges(left, right, c);
    if (q) {
      const [qa, qb] = q;
      let give = `Each ${left.sym} gives up ${qa} ${electrons(qa)}: ${left.sym} → ${left.sym}${chargeMark(qa)} + ${qa > 1 ? qa : ''}e⁻.`;
      if (left.ie !== null) give += ` The first takes ${left.ie} eV (its first ionization energy)${qa > 1 ? '; each next one takes more' : ''}.`;
      steps.push({ phase: 'moving', text: give });
      let take = `Each ${right.sym} takes ${-qb}: ${right.sym} + ${-qb > 1 ? -qb : ''}e⁻ → ${right.sym}${chargeMark(qb)}.`;
      if (right.ea !== null && right.ea > 0) {
        take += ` The first gives out ${right.ea} eV (its electron affinity)${-qb > 1 ? '; the next costs energy, paid back as the ions pack together' : ''}.`;
      }
      steps.push({ phase: 'moving', text: take });
      steps.push({ phase: 'made', text: `The ions hold together by their opposite charges, ${n[left.sym]} ${left.sym}${chargeMark(qa)} to ${n[right.sym]} ${right.sym}${chargeMark(qb)}: ${subscript(c.f)}.` });
      return steps;
    }
  }
  if (kind === 'polar' || kind === 'nonpolar') {
    const order = c.o > 0 ? Math.min(3, c.o) : 0;
    steps.push({
      phase: 'moving',
      text: order
        ? `${left.sym} and ${right.sym} share electrons, one from each per pair: ${order === 1 ? 'a single bond' : `a ${BOND_WORD[order]} bond, ${order} pairs`} in PubChem's structure.`
        : `${left.sym} and ${right.sym} share electrons, one from each per pair.`,
    });
    if (kind === 'polar') {
      steps.push({ phase: 'made', text: `${right.sym} (χ ${right.en}) pulls the shared pairs nearer than ${left.sym} (χ ${left.en}) does: a polar bond.` });
    }
    steps.push({ phase: 'made', text: `${n[left.sym]} ${left.sym} and ${n[right.sym]} ${right.sym} together make ${subscript(c.f)}.` });
    return steps;
  }
  steps.push({ phase: 'made', text: `${subscript(c.f)} forms.` });
  return steps;
}

/** every formation reaction on record: one per compound, an element with itself left out */
export function formations(bonds: Record<string, Compound[]>, bySym: (s: string) => StepElement): Reaction[] {
  const out: Reaction[] = [];
  for (const [key, list] of Object.entries(bonds)) {
    const [sa, sb] = key.split('-');
    if (sa === sb) continue;
    for (const c of list) out.push(formationOf(c, bySym(sa), bySym(sb)));
  }
  return out;
}

// ---- search, and what comes next ----

const elementsIn = (r: Reaction): Set<string> => new Set([...r.left, ...r.right].flatMap((s) => Object.keys(parseFormula(s.f))));

/**
 * Reactions matching every word of a search: a name ("rust"), a kind
 * ("combustion"), a formula ("H2O", any case) or an element symbol ("Na":
 * any reaction with sodium in it). The famous come before the formations.
 */
export function searchReactions(q: string, all: Reaction[]): Reaction[] {
  const words = q.toLowerCase().split(/[\s+→>-]+/).filter(Boolean);
  if (!words.length) return all;
  return all.filter((r) => {
    const els = [...elementsIn(r)].map((e) => e.toLowerCase());
    const formulas = [...r.left, ...r.right].map((s) => s.f.toLowerCase());
    const name = r.name.toLowerCase();
    return words.every(
      (w) =>
        els.includes(w) ||
        formulas.includes(w) ||
        (w.length >= 3 && (name.includes(w) || r.kind.toLowerCase().includes(w) || formulas.some((f) => f.includes(w)))),
    );
  });
}

/**
 * What the products go on to do: the reactions that start from any of
 * them, the famous first, at most `max`.
 */
export function nextOf(r: Reaction, all: Reaction[], max = 8): Reaction[] {
  const made = new Set(r.right.map((s) => s.f));
  return all.filter((x) => x !== r && x.left.some((s) => made.has(s.f))).slice(0, max);
}
