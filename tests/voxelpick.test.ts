import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { voxelAt } from '../src/render/voxel3d';
import { Mat } from '../src/sim/materials';

// a 4x4 world: stone at (1, 2), sand at (3, 2); flat relief
const W = 4;
const H = 4;
const cells = new Uint8Array(W * H);
cells[2 * W + 1] = Mat.STONE;
cells[2 * W + 3] = Mat.SAND;
const flat = new Float32Array(W * H);
const at = (o: [number, number, number], d: [number, number, number]) =>
  voxelAt(new Vector3(...o), new Vector3(...d).normalize(), cells, W, H, 1, flat);

describe('voxelAt: what the pointer is over in the 3D diorama', () => {
  it('names the voxel straight ahead, and nothing over an empty cell', () => {
    // cell (x, y) sits at world (x - W/2, H/2 - y)
    expect(at([-1, 0, 100], [0, 0, -1])).toBe(Mat.STONE);
    expect(at([0, 0, 100], [0, 0, -1])).toBe(Mat.EMPTY);
  });

  it('names the first voxel along a slanting ray, not one behind it', () => {
    expect(at([5, 0, 3], [-1, 0, -0.3])).toBe(Mat.SAND);
  });

  it('names nothing when the ray passes over a heap above its depth', () => {
    // starts inside the slab over the sand, too high for sand, and leaves the world too high for stone
    expect(at([1, 0, 8.5], [-1, 0, -0.5])).toBe(Mat.EMPTY);
  });

  it('gives up on a ray parallel to the slab instead of walking forever', () => {
    expect(at([-50, 0, 0], [1, 0, 0])).toBe(Mat.EMPTY);
  });
});
