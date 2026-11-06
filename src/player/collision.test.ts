import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { resolveCollisions } from './Player';

const wall = new THREE.Box3(new THREE.Vector3(0, 0, -5), new THREE.Vector3(0.3, 3, 5));

describe('collision', () => {
  it('pushes the player out of a wall', () => {
    const p = { x: 0.1, z: 0 };
    resolveCollisions(p, 0.32, [wall]);
    expect(p.x <= -0.32 + 1e-6 || p.x >= 0.62 - 1e-6).toBe(true);
  });
  it('keeps a player who is touching but not overlapping', () => {
    const p = { x: -0.5, z: 0 };
    resolveCollisions(p, 0.32, [wall]);
    expect(p).toEqual({ x: -0.5, z: 0 });
  });
  it('slides along the wall (z unchanged)', () => {
    const p = { x: -0.2, z: 2 };
    resolveCollisions(p, 0.32, [wall]);
    expect(p.x).toBeCloseTo(-0.32);
    expect(p.z).toBe(2);
  });
  it('ignores boxes above head height', () => {
    const lintel = new THREE.Box3(new THREE.Vector3(-1, 2.6, -1), new THREE.Vector3(1, 4, 1));
    const p = { x: 0, z: 0 };
    resolveCollisions(p, 0.32, [lintel]);
    expect(p).toEqual({ x: 0, z: 0 });
  });
});
