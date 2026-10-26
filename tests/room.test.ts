import { describe, expect, it } from 'vitest';
import { ROOM_MAX, roomHasSpace } from '../src/net/mp';

describe('rooms: at most nine people', () => {
  it('lets the eighth guest in (nine with the host) and turns the ninth away', () => {
    expect(ROOM_MAX).toBe(9);
    expect(roomHasSpace(0)).toBe(true);
    expect(roomHasSpace(7)).toBe(true);
    expect(roomHasSpace(8)).toBe(false);
    expect(roomHasSpace(20)).toBe(false);
  });
});
