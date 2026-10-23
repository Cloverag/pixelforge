import type { PointerEvt } from '../core/input';
import { MATS, Mat } from '../sim/materials';
import { rulesFor } from '../sim/reactions';
import type { PaletteSection, Swatch } from '../ui/hud';
import { Stroke } from './stroke';
import type { CursorLook, ModeController, ModeCtx } from './types';

/** symbol -> material, for the elements the lab simulates */
export const LAB_ELEMENTS = new Map<string, number>([
  ['H', Mat.H], ['Li', Mat.LI], ['C', Mat.C], ['N', Mat.N], ['O', Mat.O],
  ['Ne', Mat.NE], ['Na', Mat.NA], ['Mg', Mat.MG], ['Al', Mat.AL], ['P', Mat.P],
  ['S', Mat.S], ['Cl', Mat.CL], ['K', Mat.K], ['Ca', Mat.CA], ['Fe', Mat.FE],
  ['Cu', Mat.CU], ['Zn', Mat.ZN], ['Sr', Mat.SR], ['I', Mat.I], ['Ba', Mat.BA],
]);
const SYMBOL = new Map([...LAB_ELEMENTS].map(([sym, m]) => [m, sym]));

const GASES = [Mat.H, Mat.O, Mat.N, Mat.CL, Mat.NE];
const METALS = [Mat.LI, Mat.NA, Mat.K, Mat.MG, Mat.CA, Mat.SR, Mat.BA, Mat.AL, Mat.FE, Mat.CU, Mat.ZN];
const NONMETALS = [Mat.C, Mat.P, Mat.S, Mat.I];
/** the bench: things to react elements with, and to hold them */
const BENCH = [Mat.WATER, Mat.ACID, Mat.LYE, Mat.RUST, Mat.FIRE, Mat.TORCH, Mat.LAVA, Mat.PLANT, Mat.GLASS, Mat.WALL];

function rampGradient(ramp: readonly number[]): string {
  const css = (u: number) => `rgb(${u & 255},${(u >>> 8) & 255},${(u >>> 16) & 255})`;
  const [a, b, c, d] = ramp.map(css);
  return `linear-gradient(135deg, ${a} 0 25%, ${b} 25% 50%, ${c} 50% 75%, ${d} 75% 100%)`;
}

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
  readonly label = 'CHEM LAB';
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

  constructor(private ctx: ModeCtx) {
    this.stroke = new Stroke(ctx);
    const toggle = (k: 'flood' | 'wind') => () => ctx.setPaintKind(ctx.paintKind() === k ? 'brush' : k);
    this.keys = { f: toggle('flood'), w: toggle('wind'), e: () => void this.toggleTable() };
    for (let n = 1; n <= 9; n++)
      this.keys[String(n)] = () => document.querySelectorAll<HTMLElement>('#palette .swatch')[n - 1]?.click();
  }

  start(): void {
    this.ctx.post({ t: 'input', inp: { k: 'mode', m: 'chem' } });
    this.ctx.toast('PICK AN ELEMENT - E OPENS THE PERIODIC TABLE');
  }

  buildUI(): void {
    const swatch = (m: number): Swatch => {
      const d = MATS[m];
      const sym = SYMBOL.get(m);
      const chip = rampGradient(d.ramp);
      const kind = sym ? `element ${sym}` : ['', 'powder', 'liquid', 'gas', 'solid'][d.cat];
      const lines = CHEM_NOTE[m] ?? reactionLines(m).slice(0, 2).join('; ');
      return { id: String(m), label: d.name, chip, title: sym ? `${d.name} (${sym})` : d.name, info: [d.name, kind, lines, chip] };
    };
    const sections: PaletteSection[] = [
      { label: 'TABLE', cls: 'toolbtns', buttons: [{ label: 'PERIODIC TABLE', title: 'Every element; the lit ones are in the lab (E)', onClick: () => void this.toggleTable() }] },
      { label: 'GASES', swatches: GASES.map(swatch) },
      { label: 'METALS', swatches: METALS.map(swatch) },
      { label: 'NON-METALS', swatches: NONMETALS.map(swatch) },
      { label: 'BENCH', swatches: BENCH.map(swatch) },
      {
        label: 'TOOLS',
        swatches: [{ id: '-1', label: 'ERASE', chip: '#0b0b14', dashed: true, title: 'Eraser (or hold right mouse button)', info: ['ERASE', '', 'Clears whatever the brush covers.', 'transparent'] }],
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

  /** ESC closes the table before it leaves the lab */
  onEscape(): boolean {
    return this.table?.closeTable() ?? false;
  }

  cursor(pointerDown: boolean, button: number): CursorLook {
    const kind = this.ctx.paintKind();
    const erasing = this.selMat === -1 || (pointerDown && button === 2);
    return { m: this.selMat < 0 ? 0 : this.selMat, k: kind === 'wind' ? 'w' : kind === 'flood' ? 'f' : erasing ? 'e' : 'b' };
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
  [Mat.WATER]: 'Alkali metals fizz in it; iron rusts in it.',
  [Mat.FIRE]: 'Heat for reactions; metals colour it (flame tests).',
  [Mat.TORCH]: 'Steady heat that never burns out; lights neon.',
  [Mat.LAVA]: 'Heat that flows.',
  [Mat.GLASS]: 'Holds anything, reacts with nothing.',
  [Mat.WALL]: 'Holds anything, reacts with nothing.',
  [Mat.PLANT]: 'Chlorine bleaches it.',
};

