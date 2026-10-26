import type { PointerEvt } from '../core/input';
import { copyText, shareUrl } from '../game/share';
import type { PaletteSection, Swatch } from '../ui/hud';
import type { CursorLook, ModeController, ModeCtx } from './types';

type Screen = typeof import('../elements/screen');

/** the rail folded to its colour chips (and the deck hidden): the screen gets the room */
const FOLD_KEY = 'pf.el.fold';
function railFolded(): boolean {
  try {
    const v = localStorage.getItem(FOLD_KEY);
    if (v !== null) return v === '1';
  } catch {
    /* private mode: decide below */
  }
  // first visit: folded on a touch screen or anything narrower than a laptop
  return matchMedia('(pointer: coarse)').matches || window.innerWidth < 1400;
}

/** the element last looked at, so a reload comes back to it */
const LAST_KEY = 'pf.element';
function lastElement(): number {
  try {
    const z = Number(localStorage.getItem(LAST_KEY));
    return Number.isInteger(z) && z >= 1 && z <= 118 ? z : 18;
  } catch {
    return 18; // private mode: argon, as a first visit
  }
}

/**
 * ELEMENTS: the periodic table in 3D. Pick an element off the table and its
 * atom turns in front of you - nucleus, shells and the shapes of its outer
 * orbitals - beside its numbers, its spectrum and what it is used for.
 *
 * BOND pairs it with a second element and plays the bond between them;
 * REACTIONS lists balanced equations to search, each one played step by step.
 *
 * The screen (elements/screen.ts, with three.js and the element data) loads
 * on the way in. Solo, like the math lab: there is no world to share.
 */
export class ElementsMode implements ModeController {
  readonly id = 'elements';
  readonly roomName = 'ELEMENTS';
  readonly cinematic = false;
  readonly saveable = false;
  readonly view3d = 'voxel';
  readonly challengeId = null;
  /** the world's canvas is hidden here: its view lamps and skies would change nothing you can see (CRT still does) */
  readonly deckOff = ['soft', 'grid', '3d', 'ascii', 'ray', 'sky'];
  readonly keys: Record<string, () => void> = {
    arrowleft: () => this.screen?.move('left'),
    arrowright: () => this.screen?.move('right'),
    arrowup: () => this.screen?.move('up'),
    arrowdown: () => this.screen?.move('down'),
    o: () => this.toggleLayer('orbitals'),
    k: () => this.toggleLayer('shells'),
    r: () => this.toggleSpin(),
    j: () => this.toggleBond(),
    x: () => this.toggleReactions(),
  };
  private mod: Screen | null = null;
  private screen: InstanceType<Screen['ElementsScreen']> | null = null;
  private z = lastElement();
  /** an element from a #e= link, looked up once the data has loaded */
  private linked: string | null = null;
  private loading = false;
  /** left the mode while the screen was still loading: do not mount it */
  private left = false;

  constructor(private ctx: ModeCtx) {}

  /** A shared #e= link: a symbol or an atomic number, checked when the screen loads. */
  adopt(code: string): boolean {
    if (!/^([A-Za-z]{1,3}|\d{1,3})$/.test(code)) return false;
    this.linked = code;
    return true;
  }

  start(): void {
    this.ctx.post({ t: 'input', inp: { k: 'mode', m: 'elements' } });
  }

  buildUI(): void {
    this.left = false;
    if (this.mod) {
      this.mount(this.mod);
      return;
    }
    if (this.loading) return;
    this.loading = true;
    import('../elements/screen')
      .then((mod) => {
        this.mod = mod;
        if (!this.left) this.mount(mod);
      })
      .catch((err) => {
        console.error(err);
        this.ctx.toast('THE ELEMENTS FAILED TO LOAD', true);
      })
      .finally(() => {
        this.loading = false;
      });
  }

  private mount(mod: Screen): void {
    this.screen?.dispose();
    const all: Swatch = { id: 'all', label: 'ALL', chip: 'linear-gradient(135deg, #ff8a5c, #ffc65c, #8cf06a, #5ad8ff, #b99cff, #ff8ac0)', title: 'Every element lit', info: ['ALL ELEMENTS', '', 'Arrows move round the table', ''] };
    const sections: PaletteSection[] = [
      {
        label: 'LIGHT UP',
        swatches: [
          all,
          ...mod.CATEGORIES.map((c) => ({
            id: c.block,
            label: c.label,
            chip: c.tint,
            title: `Light up the ${c.one.toLowerCase()}s`,
            info: [c.one + 'S', '', '', c.tint] as Swatch['info'],
          })),
        ],
      },
      {
        label: 'ATOM',
        cls: 'toolbtns',
        buttons: [
          { label: 'ORBITALS', title: 'The shapes of the outer orbitals (O)', onClick: () => this.toggleLayer('orbitals'), lamp: 'orbitals', on: true },
          { label: 'SHELLS', title: 'The electron shells, K to Q (K)', onClick: () => this.toggleLayer('shells'), lamp: 'shells', on: true },
          { label: 'SPIN', title: 'Turn the atom slowly; drag to turn it yourself (R)', onClick: () => this.toggleSpin(), lamp: 'spin', on: true },
          { label: 'BOND', title: 'Bond it with a second element: click one on the table (J)', onClick: () => this.toggleBond(), lamp: 'bond', on: false },
          { label: 'REACTIONS', title: 'Search reactions; see how each happens and what comes next (X)', onClick: () => this.toggleReactions(), lamp: 'reactions', on: false },
          { label: '◀ PREV', title: 'The element before (←)', onClick: () => this.screen?.move('left') },
          { label: 'NEXT ▶', title: 'The element after (→)', onClick: () => this.screen?.move('right') },
          { label: 'COPY LINK', title: 'A link that opens this element', onClick: () => void this.share() },
        ],
      },
    ];
    this.ctx.hud.buildPalette(
      {
        sections,
        initial: 'all',
        onPick: (id) => this.screen?.setFilter(id === 'all' ? null : id),
        bucket: false,
        counts: 'electrons',
        hint: '',
      },
      this.ctx.brush(),
    );
    this.screen = new mod.ElementsScreen((e) => {
      this.z = e.z;
      try {
        localStorage.setItem(LAST_KEY, String(e.z));
      } catch {
        /* private mode: it just will not be remembered */
      }
      this.ctx.hud.setParticles(e.z);
      this.ctx.sfx.ui();
    }, () => {
      this.ctx.sfx.ui();
      this.syncLamps();
    }, (lab) => this.ctx.tryInLab(lab.scene ?? null, lab.hint), {
      orbitals: () => this.toggleLayer('orbitals'),
      shells: () => this.toggleLayer('shells'),
      spin: () => this.toggleSpin(),
      bond: () => this.toggleBond(),
      reactions: () => this.toggleReactions(),
      light: (id) => this.ctx.hud.select(id),
      focus: () => this.ctx.toggleFocus(),
    });
    if (this.linked) {
      const e = mod.findElement(this.linked);
      if (e) this.z = e.z;
      else this.ctx.toast('NO SUCH ELEMENT IN THAT LINK', true);
      this.linked = null;
    }
    document.getElementById('screen-wrap')?.appendChild(this.screen.root);
    document.body.classList.add('elements-on');
    this.addFold();
    this.screen.select(this.z);
    this.ctx.hud.setLamp('orbitals', this.screen.layers.orbitals);
    this.ctx.hud.setLamp('shells', this.screen.layers.shells);
    this.ctx.hud.setLamp('spin', this.screen.spinning);
    this.syncLamps();
  }

  /** the BOND and REACTIONS lamps follow the screen: a reaction picked from the list turns BOND on */
  private syncLamps(): void {
    const s = this.screen;
    this.ctx.hud.setLamp('bond', s?.bonding ?? false);
    this.ctx.hud.setLamp('reactions', s?.listing ?? false);
    s?.syncTools();
  }

  /** The rail's fold: « folds it to its colour chips and hides the deck; » brings them back. */
  private addFold(): void {
    const rail = document.getElementById('toolbar');
    if (!rail) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'px rail-fold';
    const show = (folded: boolean) => {
      document.body.classList.toggle('el-folded', folded);
      btn.textContent = folded ? '»' : '« FOLD';
      btn.title = folded ? 'Unfold the rail and the deck' : 'Fold the rail and the deck away: more room for the elements';
      btn.setAttribute('aria-label', btn.title);
      btn.setAttribute('aria-expanded', String(!folded));
      // the canvas and the atom size themselves on resize
      window.dispatchEvent(new Event('resize'));
    };
    btn.onclick = () => {
      const folded = !document.body.classList.contains('el-folded');
      try {
        localStorage.setItem(FOLD_KEY, folded ? '1' : '0');
      } catch {
        /* private mode */
      }
      this.ctx.sfx.ui();
      show(folded);
    };
    rail.prepend(btn);
    show(railFolded());
  }

  private toggleBond(): void {
    const s = this.screen;
    if (!s) return;
    s.setBond(!s.bonding);
    this.syncLamps();
    if (s.bonding) this.ctx.toast(`CLICK AN ELEMENT TO BOND IT WITH ${s.current.name.toUpperCase()}`);
  }

  private toggleReactions(): void {
    const s = this.screen;
    if (!s) return;
    s.setReactions(!s.listing);
    this.syncLamps();
    this.ctx.sfx.ui();
  }

  private async share(): Promise<void> {
    const sym = this.screen?.current.sym;
    if (!sym) return;
    const ok = await copyText(shareUrl(sym, 'e'));
    this.ctx.sfx.ui();
    this.ctx.toast(ok ? `LINK TO ${sym.toUpperCase()} COPIED` : 'COPY FAILED - THE BROWSER BLOCKED THE CLIPBOARD', !ok);
  }

  private toggleLayer(k: 'orbitals' | 'shells'): void {
    const s = this.screen;
    if (!s) return;
    const l = { ...s.layers, [k]: !s.layers[k] };
    s.setLayers(l);
    this.ctx.hud.setLamp(k, l[k]);
    s.syncTools();
    this.ctx.sfx.ui();
  }

  private toggleSpin(): void {
    const s = this.screen;
    if (!s) return;
    s.setSpin(!s.spinning);
    this.ctx.hud.setLamp('spin', s.spinning);
    s.syncTools();
    this.ctx.sfx.ui();
  }

  /** the atom has its own pointer handling (drag to turn); the world's canvas is hidden */
  onPointer(_e: PointerEvt): void {}

  onPause(p: boolean): void {
    this.screen?.setPaused(p);
  }

  leave(): void {
    this.left = true;
    this.screen?.dispose();
    this.screen = null;
    document.body.classList.remove('elements-on', 'el-folded');
    window.dispatchEvent(new Event('resize'));
  }

  cursor(): CursorLook {
    return { m: 0, k: 'b' };
  }
}
