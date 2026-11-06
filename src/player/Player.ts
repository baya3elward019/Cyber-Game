import * as THREE from 'three';

export interface PlayerSettings { sensitivity: number; invertY: boolean; headBob: boolean }

const EYE = 1.68;
const RADIUS = 0.32;
const WALK = 3.2;
const SPRINT = 5.6;
const GRAVITY = 22;
const JUMP_V = 6.2;

/** Resolves a circle (x,z,r) against axis-aligned boxes, pushing it out of overlaps. */
export function resolveCollisions(pos: { x: number; z: number }, r: number, boxes: THREE.Box3[], feetY = 0) {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const b of boxes) {
      if (b.max.y < feetY + 0.3 || b.min.y > feetY + 1.8) continue;
      const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x += (dx / d) * (r - d);
        pos.z += (dz / d) * (r - d);
      } else {
        // center inside the box: push out along the shallowest axis
        const pen = [pos.x - b.min.x + r, b.max.x - pos.x + r, pos.z - b.min.z + r, b.max.z - pos.z + r];
        const i = pen.indexOf(Math.min(...pen));
        if (i === 0) pos.x = b.min.x - r; else if (i === 1) pos.x = b.max.x + r; else if (i === 2) pos.z = b.min.z - r; else pos.z = b.max.z + r;
      }
      moved = true;
    }
    if (!moved) break;
  }
}

export class Player {
  readonly position = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  private vy = 0;
  private grounded = true;
  private keys = new Set<string>();
  private bobT = 0;
  private stepAcc = 0;
  enabled = false;
  onStep: ((sprint: boolean) => void) | null = null;

  constructor(readonly camera: THREE.PerspectiveCamera, public settings: PlayerSettings) {
    addEventListener('keydown', (e) => { if (this.enabled) this.keys.add(e.code); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement === null) return;
      const s = 0.0022 * this.settings.sensitivity;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s * (this.settings.invertY ? -1 : 1);
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
  }

  place(p: THREE.Vector3, yaw = 0) {
    this.position.copy(p);
    this.yaw = yaw; this.pitch = 0; this.vy = 0;
    this.syncCamera(0);
  }

  clearInput() { this.keys.clear(); }

  update(dt: number, colliders: THREE.Box3[]) {
    if (this.enabled) {
      const f = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
      const s = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
      const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      const speed = sprint ? SPRINT : WALK;
      const len = Math.hypot(f, s) || 1;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const vx = ((-sin * f + cos * s) / len) * speed;
      const vz = ((-cos * f - sin * s) / len) * speed;
      const moving = f !== 0 || s !== 0;

      const pos = { x: this.position.x + vx * dt, z: this.position.z + vz * dt };
      resolveCollisions(pos, RADIUS, colliders, this.position.y);
      this.position.x = pos.x; this.position.z = pos.z;

      if (this.keys.has('Space') && this.grounded) { this.vy = JUMP_V; this.grounded = false; }
      if (moving && this.grounded) {
        this.bobT += dt * (sprint ? 13 : 9);
        this.stepAcc += dt * speed;
        if (this.stepAcc > (sprint ? 0.85 : 0.7)) { this.stepAcc = 0; this.onStep?.(sprint); }
      } else this.bobT *= 0.9;
    }
    this.vy -= GRAVITY * dt;
    this.position.y += this.vy * dt;
    if (this.position.y <= 0) { this.position.y = 0; this.vy = 0; this.grounded = true; }
    this.syncCamera(dt);
  }

  private syncCamera(_dt: number) {
    const bob = this.settings.headBob ? Math.sin(this.bobT) * 0.035 : 0;
    const sway = this.settings.headBob ? Math.cos(this.bobT * 0.5) * 0.02 : 0;
    this.camera.position.set(this.position.x + sway * Math.cos(this.yaw), this.position.y + EYE + bob, this.position.z - sway * Math.sin(this.yaw));
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
