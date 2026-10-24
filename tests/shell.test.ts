import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The in-game shell: one look, always dark. Pins what R3 removed, so it stays gone. */

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

describe('the bottom bar replaces the topbar', () => {
  const gone = /#topbar|topbar|btn-group|grp-label|grp-row|topbar-groups|more-btn|more-open|\.brand\b|brand-mark|mode-label|sb-key|sb-lamp|sb-run|sb-tool|sb-fps/;

  it('leaves no topbar, group, MORE drop-down or old status segment in the shell', () => {
    for (const [name, text] of [['styles.css', css], ['index.html', html], ['hud.ts', hud], ['main.ts', main]]) {
      expect(text.match(gone), name).toBeNull();
    }
  });

  it('puts only PAUSE and MENU on the bar, and FPS behind a key', () => {
    expect(hud).toMatch(/Pause \(SPACE\)/);
    expect(hud).toMatch(/mkBtn\('MENU'/);
    expect(hud).not.toMatch(/mkBtn\('(STEP|SAVE|LOAD|SHARE|SOFT|CRT|GRID|3D|IMMERSE|BG|SFX|MUSIC)'/);
    expect(main).toMatch(/case 'd':/);
  });
});
