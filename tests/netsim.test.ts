import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Mat } from '../src/sim/materials';
import type { NetInput } from '../src/sim/protocol';
import { GuestCore, HostCore, type Wire } from '../src/net/lockstep';
import { gunzip, gzip, packSnapshot, unpackSnapshot } from '../src/net/pack';
import { RNG } from '../src/core/rng';

/**
 * Lockstep over a simulated network: one host, two guests, every message
 * delayed 1-9 frames at random (so they also arrive out of order), the
 * second guest joining mid-game from a packed, gzipped snapshot. Every peer
 * paints. All three worlds must agree at every frame they share.
 */

const strip = (x0: number, x1: number, y: number): number[] => {
  const p: number[] = [];
  for (let x = x0; x <= x1; x += 2) p.push(x, y);
  return p;
};
const paint = (pts: number[], mat: number, size = 5): NetInput => ({ k: 'paint', pts, mat, size, kind: 'brush' });

interface Packet { at: number; to: string; msg?: Wire; snap?: Promise<Uint8Array>; f?: number }

describe('lockstep over a simulated network', { timeout: 180_000 }, () => {
  it('host and two guests (one joining late) stay identical, and everyone\'s inputs land', async () => {
    const net = new RNG(77);
    let now = 0;
    const wire: Packet[] = [];
    const deliver = (to: string, p: Omit<Packet, 'at' | 'to'>) => wire.push({ at: now + 1 + net.int(9), to, ...p });

    const guests = new Set<string>(['g1']);
    const host = new HostCore((msg, to) => {
      for (const g of to ? [to] : guests) deliver(g, { msg });
    });
    const hw = new World(1);
    host.start(hw.f);

    const peers: Record<string, { core: GuestCore; w: World; hashes: Map<number, number> }> = {
      g1: { core: new GuestCore((m) => deliver('host', { msg: m })), w: new World(1), hashes: new Map() },
      g2: { core: new GuestCore((m) => deliver('host', { msg: m })), w: new World(424242), hashes: new Map() },
    };
    // g1 starts from the host's snapshot too, like any joiner
    peers.g1.w.restore(hw.snapshot());
    peers.g1.core.synced(hw.f);
    for (const m of host.framesFrom(hw.f)) peers.g1.core.receive(m);
    // g2 has been running some other world before it joins
    for (let k = 0; k < 50; k++) peers.g2.w.step();

    const hostHashes = new Map<number, number>();
    const TICKS = 900;
    const JOIN = 330;

    for (now = 0; now < TICKS + 60; now++) {
      // inputs, from everyone
      if (now === 1) host.local([paint(strip(40, 600, 330), Mat.STONE, 6)]);
      if (now === 20) host.local([paint(strip(80, 200, 120), Mat.SAND, 8)]);
      if (now === 60) peers.g1.core.local([paint(strip(350, 500, 100), Mat.WATER, 8)]);
      if (now === 120) peers.g1.core.local([paint(strip(420, 460, 300), Mat.TNT, 6), paint([440, 290], Mat.FIRE, 3)]);
      if (now === 200) host.local([{ k: 'paint', pts: strip(250, 400, 200), mat: 0, size: 10, kind: 'wind' }]);
      if (now === JOIN + 80) peers.g2.core.local([paint(strip(150, 260, 60), Mat.SNOW, 6)]);
      if (now === JOIN + 150) peers.g2.core.local([paint(strip(500, 560, 250), Mat.LAVA, 6)]);

      // the network
      for (let k = wire.length - 1; k >= 0; k--) {
        const p = wire[k];
        if (p.at > now) continue;
        wire.splice(k, 1);
        if (p.to === 'host') {
          if (p.msg) host.receive(p.msg);
        } else if (p.snap) {
          const peer = peers[p.to];
          peer.w.restore(unpackSnapshot(await gunzip(await p.snap)));
          peer.core.synced(p.f!);
        } else if (p.msg) peers[p.to].core.receive(p.msg);
      }

      // g2 joins: snapshot now, plus every frame from here, all over the wire
      if (now === JOIN) {
        guests.add('g2');
        const s = hw.snapshot();
        deliver('g2', { snap: gzip(packSnapshot(s)), f: s.f });
        for (const m of host.framesFrom(s.f)) deliver('g2', { msg: m });
      }

      // the host steps once per tick, until the end
      if (now < TICKS) {
        for (const inp of host.advance()) hw.applyInput(inp);
        hw.step();
        if (hw.f % 25 === 0) hostHashes.set(hw.f, hw.hash());
      }
      // guests step whatever they hold, catching up up to 6 a tick
      for (const peer of Object.values(peers)) {
        for (let n = 0; n < 6 && peer.core.ready(); n++) {
          for (const inp of peer.core.take()) peer.w.applyInput(inp);
          peer.w.step();
          if (peer.w.f % 25 === 0) peer.hashes.set(peer.w.f, peer.w.hash());
        }
      }
    }

    for (const [name, peer] of Object.entries(peers)) {
      let compared = 0;
      for (const [f, h] of peer.hashes) {
        if (!hostHashes.has(f)) continue;
        expect(h, `${name} diverged at frame ${f}`).toBe(hostHashes.get(f));
        compared++;
      }
      // they kept up: compared most of the session, not a handful of frames
      expect(compared, `${name} compared`).toBeGreaterThan(name === 'g1' ? 30 : 18);
      // caught up: guests also step the `delay` frames the host announced
      // ahead before it stopped
      expect(peer.w.f).toBe(hw.f + host.delay);
    }
    // the guests' inputs really reached the shared world
    expect(hw.grid.counts[Mat.WATER] + hw.grid.counts[Mat.STEAM]).toBeGreaterThan(0);
    expect(hw.grid.counts[Mat.SNOW] + hw.grid.counts[Mat.WATER]).toBeGreaterThan(0);
    let lava = 0;
    for (let x = 480; x < 580; x++) for (let y = 200; y < 335; y++) {
      const t = hw.grid.get(x, y);
      if (t === Mat.LAVA || t === Mat.STONE || t === Mat.FIRE || t === Mat.SMOKE) lava++;
    }
    expect(lava).toBeGreaterThan(0);
  });

  /**
   * A repair rewinds: the guest may be up to `delay` frames ahead of the
   * host's snapshot (it steps frames announced but not yet stepped by the
   * host), and the re-sent frames usually overtake the bigger snapshot.
   * Frames behind the guest used to be dropped as stale, so it froze.
   */
  it('a corrupted guest is repaired from a snapshot behind it, frames arriving first', () => {
    const toGuest: Wire[] = [];
    const host = new HostCore((m) => toGuest.push(m), 3);
    const hw = new World(8);
    host.start(hw.f);
    const g = new GuestCore(() => {});
    const gw = new World(8);
    gw.restore(hw.snapshot());
    g.synced(hw.f);
    for (const m of host.framesFrom(hw.f)) g.receive(m);
    const stepHost = () => {
      for (const inp of host.advance()) hw.applyInput(inp);
      hw.step();
    };
    const stepGuest = () => {
      while (g.ready()) {
        for (const inp of g.take()) gw.applyInput(inp);
        gw.step();
      }
    };
    host.local([{ k: 'paint', pts: [100, 100, 140, 100], mat: Mat.SAND, size: 8, kind: 'brush' }]);
    for (let n = 0; n < 120; n++) {
      stepHost();
      for (const m of toGuest.splice(0)) g.receive(m);
      stepGuest();
    }
    expect(g.f).toBe(host.f + host.delay); // ahead of the host's stepped frame
    // corrupt the guest
    for (let x = 300; x < 340; x++) gw.grid.setXY(x, 200, Mat.WATER);
    expect(gw.hash()).not.toBe(hw.hash());
    // repair: the host's frames from S arrive first, then the snapshot at S
    const snap = hw.snapshot();
    for (const m of host.framesFrom(snap.f)) g.receive(m);
    gw.restore(snap);
    g.synced(snap.f);
    expect(g.ready()).toBe(true);
    // and from here the two agree, frame for frame
    for (let n = 0; n < 120; n++) {
      stepHost();
      for (const m of toGuest.splice(0)) g.receive(m);
      while (g.ready() && gw.f < hw.f) {
        for (const inp of g.take()) gw.applyInput(inp);
        gw.step();
      }
      expect(gw.f).toBe(hw.f);
      expect(gw.hash()).toBe(hw.hash());
    }
  });

  it('a packed, gzipped snapshot restores exactly, and is small', async () => {
    const w = new World(3);
    for (let y = 200; y < 330; y++) for (let x = 100; x < 300; x++) w.grid.setXY(x, y, Mat.SAND);
    for (let n = 0; n < 50; n++) w.step();
    const packed = await gzip(packSnapshot(w.snapshot()));
    // 26 000 sand grains: their colours are most of it
    expect(packed.byteLength).toBeLessThan(60_000);
    const back = new World(9);
    back.restore(unpackSnapshot(await gunzip(packed)));
    expect(back.hash()).toBe(w.hash());
  });

  it('guests ignore stale and duplicate frames; host replays history to joiners', () => {
    const sent: Wire[] = [];
    const host = new HostCore((m) => sent.push(m), 3);
    host.start(100);
    host.local([{ k: 'clear' }]);
    host.advance(); // schedules the clear at frame 103
    const joiner = framesFor(host.framesFrom(101));
    expect(joiner.map((m) => m.f)).toEqual([101, 102, 103]);
    expect(joiner.find((m) => m.f === 103)!.i).toEqual([{ k: 'clear' }]);

    const g = new GuestCore(() => {});
    g.synced(101);
    for (const m of joiner) g.receive(m);
    g.receive(joiner[2]); // duplicate
    expect(g.backlog()).toBe(3);
    g.take();
    g.receive({ t: 'frame', f: 101, i: [{ k: 'clear' }] }); // stale: already stepped
    expect(g.take()).toEqual([]);
    expect(g.take()).toEqual([{ k: 'clear' }]);
    expect(g.ready()).toBe(false);
  });
});

function framesFor(ws: Wire[]) {
  return ws.filter((m): m is Extract<Wire, { t: 'frame' }> => m.t === 'frame');
}
