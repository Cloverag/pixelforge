import type { PointerEvt } from '../core/input';
import { EYE_PALETTES } from '../garden/eye';
import { bouquet, decodeGarden, encodeGarden, plantAt, type FlowerKind } from '../garden/flowers';
import { copyText, shareUrl } from '../game/share';
import { GardenView } from '../garden/view';
import type { PaletteSection, Swatch } from '../ui/hud';
import type { CursorLook, ModeController, ModeCtx } from './types';

/** The panel's flowers: id, name, chip colours, tooltip. */
const KINDS: [FlowerKind, string, string, string][] = [
  ['lily', 'LILY', 'linear-gradient(135deg,#ff6a5a 0 50%,#d61f2c 50% 100%)', 'Six pointed petals, freckles and long stamens'],
  ['tulip', 'TULIP', 'linear-gradient(135deg,#ffe08a 0 50%,#f2a33c 50% 100%)', 'A cup of three petals'],
  ['daisy', 'DAISY', 'linear-gradient(135deg,#f2c230 0 50%,#f4f2ea 50% 100%)', 'White rays around a yellow heart'],
  ['rose', 'ROSE', 'linear-gradient(135deg,#ff4a5a 0 50%,#b0122a 50% 100%)', 'Petals wound in a spiral'],
  ['sunflower', 'SUNFLOWER', 'linear-gradient(135deg,#5a3416 0 50%,#f2b81c 50% 100%)', 'A big gold head with a dark disc'],
];

/** ASCII cell sizes the GLYPH SIZE button cycles through, in screen pixels. */
const CELLS = [6, 8, 11, 15];

/**
 * The ASCII garden: three scenes drawn as coloured text (or as drawings).
 * FLOWERS - plant lilies, tulips, daisies, roses and sunflowers, or make a
 * bouquet; EYE OF WORDS - a giant eye made of words that blinks and follows
 * the pointer; 3D LILY - a lily bouquet that builds itself from wireframe to
 * lit petals while the camera orbits.
 *
 * It draws on its own canvas over the world's (garden/view.ts); the worker's
 * world sits empty underneath. Solo only for now.
 */
export class GardenMode implements ModeController {
  readonly id = 'garden';
  readonly roomName = 'ASCII GARDEN';
  readonly cinematic = false;
  readonly saveable = false;
  readonly view3d = 'voxel';
  readonly challengeId = null;
  readonly keys: Record<string, () => void> = {
    f: () => this.makeBouquet(),
    x: () => this.clear(),
    a: () => this.toggleAscii(),
    e: () => this.show('eye'),
    l: () => this.show('lily3d'),
    o: () => this.show('bloom'),
  };
  private kind: FlowerKind = 'lily';
  private view = new GardenView('garden-on');
  private cellIdx = 1;
  private seed = 1;

  constructor(private ctx: ModeCtx) {}

  start(): void {
    this.ctx.post({ t: 'input', inp: { k: 'mode', m: 'garden' } });
  }

  buildUI(): void {
    const swatches: Swatch[] = KINDS.map(([id, label, chip, title]) => ({ id, label, chip, title, info: [label, '', title, chip] }));
    const sections: PaletteSection[] = [
      {
        label: 'SCENES',
        cls: 'scenebtns',
        buttons: [
          { label: 'BOUQUET', title: 'A whole new bouquet of flowers (F)', onClick: () => this.makeBouquet(), cls: 'surprise' },
          { label: 'EYE OF WORDS', title: 'A giant eye made of words: it blinks and follows the pointer (E)', onClick: () => this.show('eye') },
          { label: '3D LILY', title: 'A lily bouquet that builds itself in 3D (L)', onClick: () => this.show('lily3d') },
          { label: 'BLOOM', title: "One flower's life in dots: it sprouts, blooms, wilts and starts again (O)", onClick: () => this.show('bloom') },
        ],
      },
      { label: 'PLANT', swatches },
      {
        label: 'LOOK',
        cls: 'toolbtns',
        buttons: [
          { label: 'ASCII', title: 'As text, or as drawings (A)', onClick: () => this.toggleAscii(), lamp: 'ascii', on: true },
          { label: 'GLYPH SIZE', title: 'Bigger or smaller characters', onClick: () => this.cycleCell() },
          { label: 'COLOURS', title: "The eye's colours", onClick: () => this.cyclePalette() },
          { label: 'CLEAR', title: 'Pick every flower (X)', onClick: () => this.clear() },
        ],
      },
      {
        label: 'SHARE',
        cls: 'toolbtns',
        buttons: [{ label: 'COPY LINK', title: 'A link that opens this garden, flower for flower', onClick: () => void this.share() }],
      },
    ];
    this.ctx.hud.buildPalette(
      {
        sections,
        initial: this.kind,
        onPick: (id) => {
          this.kind = id as FlowerKind;
          this.ctx.sfx.ui();
          // picking a flower means planting: back to the flower bed
          if (this.view.scene !== 'flowers') this.show('flowers');
        },
        bucket: false,
        counts: 'particles',
        hint: 'Click to plant a flower, or pick a scene',
      },
      this.ctx.brush(),
    );
    if (!this.view.mounted()) {
      this.view.mount();
      if (this.view.flowers.length === 0) this.view.setScene('flowers', this.seed++ * 104729);
    }
    this.ctx.hud.setLamp('ascii', this.view.ascii);
    this.count();
  }

  onPointer(e: PointerEvt): void {
    if (e.phase !== 'down' || this.view.scene !== 'flowers') return;
    const fl = this.view.flowers;
    if (e.button === 2) {
      // right click picks the nearest flower
      let best = -1;
      let bd = 40 * 40;
      fl.forEach((f, i) => {
        const d = (f.x - e.x) ** 2 + (f.y - e.y) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (best >= 0) fl.splice(best, 1);
      this.count();
      return;
    }
    const size = this.kind === 'lily' ? 26 + this.ctx.brush() : 16 + this.ctx.brush() * 0.6;
    fl.push(plantAt(this.kind, e.x, e.y, size, this.view.now(), this.seed++ * 7919));
    this.ctx.sfx.place();
    this.count();
  }

  private count(): void {
    const bed = this.view.scene === 'flowers';
    this.ctx.hud.setHint(bed ? 'Click to plant a flower, or pick a scene' : '');
    this.ctx.hud.setParticles(bed ? this.view.flowers.length : 0);
  }

  private show(s: 'flowers' | 'eye' | 'lily3d' | 'bloom'): void {
    this.view.setScene(s, this.seed++ * 31337);
    this.ctx.sfx.ui();
    if (s === 'eye') this.ctx.toast('EYE OF WORDS - MOVE THE POINTER, IT FOLLOWS');
    if (s === 'lily3d') this.ctx.toast('3D LILY - WATCH IT BUILD');
    if (s === 'bloom') this.ctx.toast('BLOOM - A FLOWER FROM SEED TO WILT, IN DOTS');
    this.count();
  }

  makeBouquet(): void {
    this.view.flowers = bouquet(this.seed++ * 104729, this.view.now());
    this.view.setScene('flowers');
    this.count();
    this.ctx.sfx.ui();
  }

  /** A garden from a link: shown when the mode starts. False if the code is not one. */
  adopt(code: string): boolean {
    const fl = decodeGarden(code, this.view.now());
    if (!fl) return false;
    this.view.flowers = fl;
    this.view.setScene('flowers');
    return true;
  }

  private async share(): Promise<void> {
    const fl = this.view.flowers;
    if (this.view.scene !== 'flowers' || fl.length === 0) {
      this.ctx.toast('PLANT SOME FLOWERS FIRST', true);
      return;
    }
    const ok = await copyText(shareUrl(encodeGarden(fl), 'g'));
    this.ctx.sfx.ui();
    this.ctx.toast(ok ? 'GARDEN LINK COPIED' : 'COPY FAILED - THE BROWSER BLOCKED THE CLIPBOARD', !ok);
  }

  private clear(): void {
    this.view.setScene('flowers');
    // an empty bed, on purpose (setScene refills an empty one with a bouquet)
    this.view.flowers = [];
    this.count();
    this.ctx.sfx.ui();
  }

  private toggleAscii(): void {
    if (!this.view.hasFilter) {
      this.ctx.toast('THE TEXT FILTER NEEDS WEBGL2', true);
      return;
    }
    this.view.ascii = !this.view.ascii;
    this.ctx.hud.setLamp('ascii', this.view.ascii);
    this.ctx.sfx.ui();
  }

  private cycleCell(): void {
    this.cellIdx = (this.cellIdx + 1) % CELLS.length;
    this.view.cellPx = CELLS[this.cellIdx];
    this.ctx.sfx.ui();
    this.ctx.toast(`GLYPHS ${CELLS[this.cellIdx]} PX`);
  }

  private cyclePalette(): void {
    this.view.palette = (this.view.palette + 1) % EYE_PALETTES.length;
    this.ctx.sfx.ui();
    this.ctx.toast(`EYE: ${EYE_PALETTES[this.view.palette].name}`);
  }

  onPause(p: boolean): void {
    this.view.setPaused(p);
  }

  leave(): void {
    this.view.unmount();
  }

  cursor(): CursorLook {
    return { m: 0, k: 'b' };
  }
}
