import { beforeEach, describe, expect, it } from 'vitest';
import { cleanName, initials, myIdentity, PLAYER_COLORS } from '../src/net/presence';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  } as Storage;
});

describe('player identity', () => {
  it('is made up once and then kept on this device', () => {
    const a = myIdentity();
    expect(a.name).toMatch(/^[A-Z]+ [A-Z]+$/);
    expect(PLAYER_COLORS).toContain(a.color);
    expect(myIdentity()).toEqual(a);
  });

  it('survives storage being unavailable', () => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    } as unknown as Storage;
    expect(myIdentity().name.length).toBeGreaterThan(3);
  });

  it('shortens a name to initials', () => {
    expect(initials('SANDY FOX')).toBe('SF');
    expect(initials('X')).toBe('X');
  });

  it('cleans a typed name: capitals, digits, single spaces, 14 max', () => {
    expect(cleanName('lava queen!!')).toBe('LAVA QUEEN');
    expect(cleanName('  a   b  ')).toBe('A B');
    expect(cleanName('<script>x</script>')).toBe('SCRIPTXSCRIPT');
    expect(cleanName('abcdefghijklmnopqrstuvwxyz')).toHaveLength(14);
    expect(cleanName('!!!')).toBe('');
  });
});
