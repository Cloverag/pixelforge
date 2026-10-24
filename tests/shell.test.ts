import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The in-game shell: always dark, the bar on top, the dock of colours below. Pins what was removed, so it stays gone. */

const root = join(__dirname, '..');
const css = readFileSync(join(root, 'src', 'styles.css'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const hud = readFileSync(join(root, 'src', 'ui', 'hud.ts'), 'utf8');
const main = readFileSync(join(root, 'src', 'main.ts'), 'utf8');

describe('one look, always dark', () => {
  it('has no light theme: no data-theme rule, no light colour-scheme query', () => {
    expect(css).not.toMatch(/data-theme/);
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(html).not.toMatch(/data-theme|pf-theme/);
    expect(existsSync(join(root, 'src', 'ui', 'theme.ts'))).toBe(false);
  });

  it('has no LED, lamp or bezel left', () => {
    expect(css).not.toMatch(/\.led\b|\.has-led|\.sb-lamp|#led\b|#bezel|#glass/);
    expect(html).not.toMatch(/id="(bezel|led|glass)"/);
  });
});

describe('the bar: the three modes, PAUSE and MENU', () => {
  const gone = /#topbar|topbar|btn-group|grp-label|grp-row|topbar-groups|more-btn|more-open|\.brand\b|brand-mark|mode-label|sb-key|sb-lamp|sb-run|sb-tool|sb-fps/;

  it('leaves no topbar, group, MORE drop-down or old status segment in the shell', () => {
    for (const [name, text] of [['styles.css', css], ['index.html', html], ['hud.ts', hud], ['main.ts', main]]) {
      expect(text.match(gone), name).toBeNull();
    }
  });

  it('puts the three modes, PAUSE and MENU on the bar, and FPS behind a key', () => {
    expect(hud).toMatch(/\['sand', 'Sandbox'\],\n  \['playground', 'Playground'\],\n  \['chem', 'Chem lab'\],/);
    expect(hud).toMatch(/Pause \(SPACE\)/);
    expect(hud).toMatch(/mkBtn\('Menu'/);
    expect(hud).not.toMatch(/mkBtn\('(STEP|SAVE|LOAD|SHARE|SOFT|CRT|GRID|3D|IMMERSE|BG|SFX|MUSIC)'/);
    expect(main).toMatch(/case 'd':/);
  });
});

describe('the dock: coloured buttons and five brush dots', () => {
  it('has no brush slider, number, preview square or hint left', () => {
    expect(css).not.toMatch(/brushrow|brush-preview|brush-dot|input\[type=.range.\]/);
    expect(hud).not.toMatch(/type = 'range'|brushrow|brush-preview|Wheel or \[ \] to resize/);
  });

  it('every text size in the stylesheet is at least 14px (the game screens have a type floor)', () => {
    // the title screen's footer and LIVE caption are clamp()ed from 11px by design (R1); everything else is >= 14
    const small = [...css.matchAll(/font-size:\s*([0-9.]+)px/g)].filter((m) => Number(m[1]) < 14).map((m) => m[0]);
    expect(small).toEqual([]);
  });

  it('never truncates a name with an ellipsis in the rail, bar or buttons', () => {
    const rules = css.split('}').filter((r) => /text-overflow:\s*ellipsis/.test(r));
    const touched = rules.map((r) => r.split('{')[0].trim());
    expect(touched.filter((sel) => /swatch|sb-|scenebtns|toolbtns|#toolbar|button\.px/.test(sel))).toEqual([]);
  });
});

describe('phones', () => {
  it('the title screen demo covers the screen, cropped, at any shape', async () => {
    const { coverSize } = await import('../src/render/blocks');
    for (const [w, h] of [[390, 844], [844, 390], [1920, 1080], [2560, 1080], [1024, 1366]]) {
      const c = coverSize(w, h);
      expect(c.w, `${w}x${h} wide enough`).toBeGreaterThanOrEqual(w);
      expect(c.h, `${w}x${h} tall enough`).toBeGreaterThanOrEqual(h);
      expect(Math.abs(c.w / c.h - 16 / 9), `${w}x${h} still 16:9`).toBeLessThan(0.02);
    }
    // a tall phone crops the sides, never letterboxes: the canvas is taller than the screen's 16:9 strip
    expect(coverSize(390, 844).w).toBeGreaterThan(390);
  });

  it('keeps 44px touch targets on phones and no MORE drop-down', () => {
    const portrait = css.slice(css.indexOf('@media (max-width: 900px) and (orientation: portrait)'));
    const landscape = css.slice(css.indexOf('@media (max-height: 520px) and (orientation: landscape)'));
    for (const [name, block] of [['portrait', portrait], ['landscape', landscape]]) {
      const body = block.slice(0, block.indexOf('\n}\n'));
      expect(body, name).toMatch(/\.swatch, #toolbar button\.px \{ height: 44px; min-height: 44px; \}/);
      expect(body, name).toMatch(/\.bdot \{ width: \d+px; height: 44px; \}/);
      expect(body, name).toMatch(/button\.px\.sq \{ width: 44px; height: 44px; \}/);
    }
    expect(css).toMatch(/\.ts-item \{ min-height: 44px;/);
    expect(css + hud + main).not.toMatch(/\bMORE\b/);
  });
});

describe('tools are always reachable', () => {
  const chem = readFileSync(join(root, 'src', 'modes', 'chem.ts'), 'utf8');
  const playground = readFileSync(join(root, 'src', 'modes', 'playground.ts'), 'utf8');

  it('ERASE is pinned beside the brush in every mode; the playground pins only ERASE', () => {
    expect(hud).toMatch(/label: 'ERASE',[^}]*pin: true/);
    expect(chem).toMatch(/label: 'ERASE'[^}]*pin: true/);
    expect(playground).toMatch(/pin: id === 'erase',\n/);
  });

  it('BUCKET and WIND join ERASE on the pinned row, not in the scrolling list', () => {
    expect(hud).toMatch(/addToolTiles\(pinned\)/);
    expect(hud).toMatch(/h\('div', 'pinrow'\)/);
    expect(hud).toMatch(/tools\.appendChild\(pinned\)/);
  });
});

describe('type: read for sentences and names, display for buttons and headings', () => {
  const rule = (sel: string): string => {
    const i = css.indexOf(`\n${sel} {`);
    return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
  };

  it('the page default is read type (Silkscreen is only the title screen footers)', () => {
    expect(rule('html, body')).toMatch(/font-family: var\(--font-read\)/);
    const silk = [...css.matchAll(/font-family: var\(--font\)/g)].length;
    expect(silk).toBe(2); // .ts-foot and .menu-live
  });

  it('every heading is the read face, bold (pixel type is only for the title screen and the logo)', () => {
    expect(css).toMatch(/\nh2 \{ font-family: var\(--font-read\); font-weight: 700;/);
  });

  it('the room badge is read type on one line, with 14px buttons', () => {
    const pill = rule('.room-pill');
    expect(pill).toMatch(/font-family: var\(--font-read\)/);
    expect(pill).toMatch(/white-space: nowrap/);
    expect(pill).toMatch(/font-size: 14px/);
  });
});
