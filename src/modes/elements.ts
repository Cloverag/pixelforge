import type { PointerEvt } from '../core/input';
import type { PaletteSection, Swatch } from '../ui/hud';
import type { CursorLook, ModeController, ModeCtx } from './types';

type Screen = typeof import('../elements/screen');

/**
 * ELEMENTS: the periodic table in 3D. Pick an element off the table and its
 * atom turns in front of you - nucleus, shells and the shapes of its outer
 * orbitals - beside its numbers, its spectrum and what it is used for.
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
  readonly keys: Record<string, () => void> = {
    arrowleft: () => this.screen?.move('left'),
    arrowright: () => this.screen?.move('right'),
    arrowup: () => this.screen?.move('up'),
    arrowdown: () => this.screen?.move('down'),
    o: () => this.toggleLayer('orbitals'),
    k: () => this.toggleLayer('shells'),
    r: () => this.toggleSpin(),
  };
  private mod: Screen | null = null;
  private screen: InstanceType<Screen['ElementsScreen']> | null = null;
  private z = 18;
  private loading = false;
  /** left the mode while the screen was still loading: do not mount it */
  private left = false;

  constructor(private ctx: ModeCtx) {}

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
          { label: '◀ PREV', title: 'The element before (←)', onClick: () => this.screen?.move('left') },
          { label: 'NEXT ▶', title: 'The element after (→)', onClick: () => this.screen?.move('right') },
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
      this.ctx.hud.setParticles(e.z);
      this.ctx.sfx.ui();
    });
    document.getElementById('screen-wrap')?.appendChild(this.screen.root);
    document.body.classList.add('elements-on');
    this.screen.select(this.z);
    this.ctx.hud.setLamp('orbitals', this.screen.layers.orbitals);
    this.ctx.hud.setLamp('shells', this.screen.layers.shells);
    this.ctx.hud.setLamp('spin', this.screen.spinning);
  }

  private toggleLayer(k: 'orbitals' | 'shells'): void {
    const s = this.screen;
    if (!s) return;
    const l = { ...s.layers, [k]: !s.layers[k] };
    s.setLayers(l);
    this.ctx.hud.setLamp(k, l[k]);
    this.ctx.sfx.ui();
  }

  private toggleSpin(): void {
    const s = this.screen;
    if (!s) return;
    s.setSpin(!s.spinning);
    this.ctx.hud.setLamp('spin', s.spinning);
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
    document.body.classList.remove('elements-on');
  }

  cursor(): CursorLook {
    return { m: 0, k: 'b' };
  }
}
