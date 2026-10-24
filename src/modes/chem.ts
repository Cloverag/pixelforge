import type { PointerEvt } from '../core/input';
import { MATS, Mat } from '../sim/materials';
import { rulesFor } from '../sim/reactions';
import { CHEM_SCENES } from '../sim/chemscenes';
import type { Res } from '../sim/protocol';
import { RxWindow, readoutNote } from './rxwindow';
import { rampGradient, type PaletteSection, type Swatch } from '../ui/hud';
import { Stroke } from './stroke';
import type { CursorLook, ModeController, ModeCtx } from './types';
import { confirmDialog } from '../ui/dialog';

/** symbol -> material, for the elements the lab simulates */
export const LAB_ELEMENTS = new Map<string, number>([
  ['H', Mat.H], ['Li', Mat.LI], ['C', Mat.C], ['N', Mat.N], ['O', Mat.O],
  ['Ne', Mat.NE], ['Na', Mat.NA], ['Mg', Mat.MG], ['Al', Mat.AL], ['P', Mat.P],
  ['S', Mat.S], ['Cl', Mat.CL], ['K', Mat.K], ['Ca', Mat.CA], ['Fe', Mat.FE],
  ['Cu', Mat.CU], ['Zn', Mat.ZN], ['Sr', Mat.SR], ['I', Mat.I], ['Ba', Mat.BA],
  ['He', Mat.HE], ['B', Mat.B], ['F', Mat.F], ['Si', Mat.SI], ['Br', Mat.BR],
  ['Ag', Mat.AG], ['Sn', Mat.SN], ['Cs', Mat.CS], ['Au', Mat.AU], ['Hg', Mat.HG],
  ['U', Mat.U], ['Pu', Mat.PU],
]);
const SYMBOL = new Map([...LAB_ELEMENTS].map(([sym, m]) => [m, sym]));
/** material -> atomic number, for the rail's tiles. Written out (from
 *  data/elements.json) rather than imported: that file loads with the periodic
 *  table, not with the game. tests/periodic.test.ts checks it against the JSON. */
export const LAB_Z = new Map<number, number>([
  [Mat.H, 1], [Mat.HE, 2], [Mat.LI, 3], [Mat.B, 5], [Mat.C, 6], [Mat.N, 7], [Mat.O, 8], [Mat.F, 9],
  [Mat.NE, 10], [Mat.NA, 11], [Mat.MG, 12], [Mat.AL, 13], [Mat.SI, 14], [Mat.P, 15], [Mat.S, 16],
  [Mat.CL, 17], [Mat.K, 19], [Mat.CA, 20], [Mat.FE, 26], [Mat.CU, 29], [Mat.ZN, 30], [Mat.BR, 35],
  [Mat.SR, 38], [Mat.AG, 47], [Mat.SN, 50], [Mat.I, 53], [Mat.CS, 55], [Mat.BA, 56], [Mat.AU, 79], [Mat.HG, 80],
  [Mat.U, 92], [Mat.PU, 94],
]);

const GASES = [Mat.H, Mat.O, Mat.N, Mat.CL, Mat.NE, Mat.HE, Mat.F];
const METALS = [Mat.LI, Mat.NA, Mat.K, Mat.CS, Mat.MG, Mat.CA, Mat.SR, Mat.BA, Mat.AL, Mat.FE, Mat.CU, Mat.ZN, Mat.AG, Mat.SN, Mat.AU];
const NONMETALS = [Mat.C, Mat.P, Mat.S, Mat.I, Mat.B, Mat.SI];
const LIQUIDS = [Mat.BR, Mat.HG];
/** fission: the two fissile metals, neutrons to start them, boron to stop them */
const NUCLEAR = [Mat.U, Mat.PU, Mat.NEUTRON, Mat.B];
/** the bench: things to react elements with, and to hold them */
const BENCH = [Mat.WATER, Mat.ACID, Mat.LYE, Mat.RUST, Mat.FIRE, Mat.TORCH, Mat.LAVA, Mat.PLANT, Mat.GLASS, Mat.WALL];

/** What a material does in the lab, one line per rule it is in: its own
 *  rules as written, the others as "sodium: fizzes in water". */
export function reactionLines(m: number): string[] {
  return rulesFor(m).map((r) => (r.a === m ? r.note : `${MATS[r.a].name.toLowerCase()}: ${r.note}`));
}

/**
 * The CHEM LAB: the sandbox's cellular world, painted with elements. The
 * reactions are the world's (sim/reactions.ts); this screen is the rail of
 * elements and bench materials, and the periodic table to pick from.
 */
export class ChemMode implements ModeController {
  readonly id = 'chem';
  readonly roomName = 'CHEM LAB';
  readonly cinematic = false;
  // a bench is for experiments: no save, like the playground
  readonly saveable = false;
  readonly view3d = 'voxel';
  readonly challengeId = null;
  readonly keys: Record<string, () => void>;
  private selMat: number = Mat.NA;
  private stroke: Stroke;
  private table: typeof import('../ui/periodic') | null = null;
  /** the status bar's reactions readout: a rolling second of Res.rx deltas */
  private rx = new RxWindow();
  private rxShownAt = 0;

  constructor(private ctx: ModeCtx) {
    this.stroke = new Stroke(ctx);
    const toggle = (k: 'flood' | 'wind') => () => ctx.setPaintKind(ctx.paintKind() === k ? 'brush' : k);
    this.keys = { f: toggle('flood'), w: toggle('wind'), e: () => void this.toggleTable(), x: () => void this.clear() };
    for (let n = 1; n <= 9; n++)
      this.keys[String(n)] = () => document.querySelectorAll<HTMLElement>('#palette .swatch')[n - 1]?.click();
  }

  /** CLEAR: an empty world, after asking - a sandbox can hold hours of building. */
  async clear(): Promise<void> {
    const ok = await confirmDialog({
      title: 'CLEAR THE WORLD?',
      body: 'Everything here goes - in a room, for everyone. Save first if you want to keep it.',
      ok: 'CLEAR',
      cancel: 'KEEP IT',
    });
    if (!ok) return;
    this.ctx.send({ k: 'clear' });
    this.ctx.sfx.ui();
  }

  start(): void {
    this.ctx.post({ t: 'input', inp: { k: 'mode', m: 'chem' } });
    this.ctx.toast('PICK AN ELEMENT - E OPENS THE PERIODIC TABLE');
  }

  buildUI(): void {
    this.rxShownAt = 0; // show the readout on the first frame, not 250 ms later
    const swatch = (m: number): Swatch => {
      const d = MATS[m];
      const sym = SYMBOL.get(m);
      const chip = rampGradient(d.ramp);
      const kind = sym ? `element ${sym}` : ['', 'powder', 'liquid', 'gas', 'solid'][d.cat];
      const lines = CHEM_NOTE[m] ?? reactionLines(m).slice(0, 2).join('; ');
      const name = d.name[0] + d.name.slice(1).toLowerCase();
      return { id: String(m), label: d.name, chip, title: sym ? `${name} (${sym})` : d.name, info: [d.name, kind, lines, chip], sym, z: LAB_Z.get(m) };
    };
    const sections: PaletteSection[] = [
      { label: 'TABLE', cls: 'toolbtns', buttons: [{ label: 'PERIODIC TABLE', title: 'Every element; the lit ones are in the lab (E)', onClick: () => void this.toggleTable() }] },
      {
        label: 'EXPERIMENTS',
        cls: 'scenebtns',
        buttons: CHEM_SCENES.map((s) => ({ label: s.label, title: s.tip, onClick: () => this.loadScene(s.id, s.label) })),
      },
      { label: 'GASES', swatches: GASES.map(swatch), tiles: true },
      { label: 'METALS', swatches: METALS.map(swatch), tiles: true },
      { label: 'NON-METALS', swatches: NONMETALS.map(swatch), tiles: true },
      { label: 'LIQUIDS', swatches: LIQUIDS.map(swatch), tiles: true },
      { label: 'NUCLEAR', swatches: NUCLEAR.map(swatch), tiles: true },
      { label: 'BENCH', swatches: BENCH.map(swatch) },
      {
        label: 'TOOLS',
        swatches: [{ id: '-1', label: 'ERASE', chip: 'var(--world-bg)', dashed: true, pin: true, title: 'Eraser (or hold right mouse button)', info: ['ERASE', '', 'Clears whatever the brush covers.', 'transparent'] }],
      },
    ];
    this.ctx.hud.buildPalette(
      {
        sections,
        initial: String(this.selMat),
        onPick: (id) => {
          this.selMat = Number(id);
          this.ctx.sfx.ui();
        },
        bucket: true,
        counts: 'cells',
        hint: 'Pick an element and draw it here. Or start an experiment.',
      },
      this.ctx.brush(),
    );
  }

  onPointer(e: PointerEvt): void {
    this.stroke.at(e, e.button === 2 || this.selMat === -1 ? Mat.EMPTY : this.selMat);
  }

  leave(): void {
    this.stroke.end();
    this.table?.closeTable();
  }

  /**
   * The readout: the worker reports what fired each frame (display only, so
   * the clock here is the page's, not the simulation's); about four times a
   * second it is summed over the last second and handed to the status bar.
   */
  onFrame(r: Res): void {
    const now = performance.now();
    if (r.rx) this.rx.add(now, r.rx);
    if (now - this.rxShownAt < 250) return;
    this.rxShownAt = now;
    const { rate, top } = this.rx.read(now);
    this.ctx.hud.setReadout(rate, top === null ? null : readoutNote(top));
    this.ctx.musicAdapt(rate);
  }

  /** ESC closes the table before it leaves the lab */
  onEscape(): boolean {
    return this.table?.closeTable() ?? false;
  }

  cursor(pointerDown: boolean, button: number): CursorLook {
    const kind = this.ctx.paintKind();
    const erasing = this.selMat === -1 || (pointerDown && button === 2);
    return { m: this.selMat < 0 ? 0 : this.selMat, k: kind === 'wind' ? 'w' : kind === 'flood' ? 'f' : erasing ? 'e' : 'b' };
  }

  private loadScene(id: string, label: string): void {
    this.ctx.send({ k: 'chemScene', id });
    this.ctx.sfx.ui();
    this.ctx.toast(`EXPERIMENT: ${label}`);
  }

  private async toggleTable(): Promise<void> {
    this.ctx.sfx.ui();
    this.table ??= await import('../ui/periodic');
    if (this.table.closeTable()) return;
    this.table.openTable({
      live: LAB_ELEMENTS,
      selected: this.selMat,
      reactions: reactionLines,
      // picked in the rail too, so the status bar and the brush agree
      onPick: (m) => this.ctx.hud.select(String(m)),
    });
  }
}

/** Bench materials whose lab role is not a rule of their own. */
const CHEM_NOTE: Partial<Record<number, string>> = {
  [Mat.U]: 'A neutron splits it into heat and 2 more neutrons. A small lump lets them escape; a big one (critical mass) keeps them - a chain reaction.',
  [Mat.PU]: 'Splits more easily than uranium and gives 3 neutrons: its critical mass is much smaller.',
  [Mat.NEUTRON]: 'Paint them to fire neutrons in every direction. They pass through most things; boron soaks them up.',
  [Mat.B]: 'Boron soaks up neutrons: control rods. Cage uranium in it and the chain cannot run.',
  [Mat.WATER]: 'Alkali metals fizz in it; iron rusts in it.',
  [Mat.FIRE]: 'Heat for reactions; metals colour it (flame tests).',
  [Mat.TORCH]: 'Steady heat that never burns out; lights neon.',
  [Mat.LAVA]: 'Heat that flows.',
  [Mat.GLASS]: 'Holds anything, reacts with nothing.',
  [Mat.WALL]: 'Holds anything, reacts with nothing.',
  [Mat.PLANT]: 'Fluorine, chlorine and bromine bleach it.',
  // elements with no rule of their own
  [Mat.HE]: 'Inert. The lightest thing in the lab: it rises above hydrogen.',
  [Mat.AU]: 'Inert. Nothing in the lab attacks it; it sinks through almost everything.',
};

