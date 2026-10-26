import { fitRect, lineArt, maskPoints, type Rect } from '../game/lineart';
import { MATS, Mat } from '../sim/materials';
import { SIM_H, SIM_W } from '../sim/protocol';
import { panelDialog } from './dialog';

/** What the outlines can be made of: solids that stay where they are drawn, each with something to do to it. */
export const PICTURE_MATS: { mat: number; tip: string }[] = [
  { mat: Mat.WOOD, tip: 'Wood: set it alight' },
  { mat: Mat.STONE, tip: 'Stone: pour water or sand over it' },
  { mat: Mat.WALL, tip: 'Wall: nothing gets through' },
  { mat: Mat.ICE, tip: 'Ice: melt it with lava' },
  { mat: Mat.GLASS, tip: 'Glass' },
  { mat: Mat.PLANT, tip: 'Plant: water makes it grow' },
];

/** A material's own colour, as CSS (the ramp is ABGR). */
function css(m: number): string {
  const c = MATS[m].ramp[0];
  return `rgb(${c & 255}, ${(c >> 8) & 255}, ${(c >> 16) & 255})`;
}

/** The picture drawn into a SIM_W x SIM_H canvas, fitted; its pixels and where it sits. */
async function rasterise(file: Blob): Promise<{ rgba: Uint8ClampedArray; rect: Rect }> {
  const bmp = await createImageBitmap(file);
  const rect = fitRect(bmp.width, bmp.height, SIM_W, SIM_H, 6);
  const c = document.createElement('canvas');
  c.width = SIM_W;
  c.height = SIM_H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, rect.x, rect.y, rect.w, rect.h);
  bmp.close();
  return { rgba: g.getImageData(0, 0, SIM_W, SIM_H).data, rect };
}

/**
 * PICTURE: a photo as line art in the world. Shows the outlines as they
 * will be drawn, with DETAIL and the material to make them of; resolves to
 * the cells and material to paint, or null if the player backs out.
 */
export async function pictureDialog(file: Blob): Promise<{ pts: number[]; mat: number } | null> {
  let img: { rgba: Uint8ClampedArray; rect: Rect };
  try {
    img = await rasterise(file);
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    const d = panelDialog('YOUR PICTURE AS LINES', () => finish(false));
    if (!d) {
      resolve(null);
      return;
    }
    d.box.classList.add('pic-dialog');
    let detail = 0.35;
    let mat: number = Mat.WOOD;
    let mask: Uint8Array = new Uint8Array(0);

    const view = document.createElement('canvas');
    view.className = 'pic-view';
    view.width = SIM_W;
    view.height = SIM_H;
    const vg = view.getContext('2d')!;
    const pix = vg.createImageData(SIM_W, SIM_H);
    const count = document.createElement('p');
    count.className = 'pf-dialog-hint';

    const draw = () => {
      const c = MATS[mat].ramp[0];
      for (let i = 0; i < mask.length; i++) {
        const on = mask[i] === 1;
        pix.data[i * 4] = on ? c & 255 : 12;
        pix.data[i * 4 + 1] = on ? (c >> 8) & 255 : 10;
        pix.data[i * 4 + 2] = on ? (c >> 16) & 255 : 24;
        pix.data[i * 4 + 3] = 255;
      }
      vg.putImageData(pix, 0, 0);
      let n = 0;
      for (const v of mask) n += v;
      count.textContent = `${n.toLocaleString()} cells of ${MATS[mat].name.toLowerCase()}, drawn over what is there`;
    };
    const rebuild = () => {
      mask = lineArt(img.rgba, SIM_W, SIM_H, img.rect, detail);
      draw();
    };

    const slider = document.createElement('label');
    slider.className = 'pic-row';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.05';
    input.value = String(detail);
    input.setAttribute('aria-label', 'Detail');
    input.addEventListener('input', () => {
      detail = Number(input.value);
      rebuild();
    });
    const key = document.createElement('span');
    key.textContent = 'DETAIL';
    slider.append(key, input);

    const mats = document.createElement('div');
    mats.className = 'pic-mats';
    const matBtns = PICTURE_MATS.map(({ mat: m, tip }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pic-mat';
      b.title = tip;
      b.style.setProperty('--c', css(m));
      b.textContent = MATS[m].name;
      b.setAttribute('aria-pressed', String(m === mat));
      b.onclick = () => {
        mat = m;
        for (const o of matBtns) o.setAttribute('aria-pressed', String(o === b));
        draw();
      };
      mats.append(b);
      return b;
    });

    const row = document.createElement('div');
    row.className = 'pf-dialog-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'px';
    cancel.textContent = 'CANCEL';
    cancel.onclick = () => finish(false);
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'px primary';
    ok.textContent = 'DRAW IT';
    ok.onclick = () => finish(true);
    row.append(cancel, ok);

    d.box.append(view, slider, mats, count, row);
    rebuild();
    d.onEnter(() => finish(true));
    requestAnimationFrame(() => ok.focus());

    function finish(yes: boolean): void {
      d!.close();
      resolve(yes ? { pts: maskPoints(mask, SIM_W), mat } : null);
    }
  });
}
