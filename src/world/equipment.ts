import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { brushedMetal, keyboardTexture, rackFront } from './textures';
import { ScreenTexture, type Painter } from './screens';

/** Shared materials, created once. */
export class Mats {
  readonly darkMetal: THREE.MeshStandardMaterial;
  readonly steel: THREE.MeshStandardMaterial;
  readonly blackPlastic: THREE.MeshStandardMaterial;
  readonly deskTop: THREE.MeshStandardMaterial;
  readonly fabric: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshPhysicalMaterial;
  readonly keyboard: THREE.MeshStandardMaterial;
  readonly lightPanel: THREE.MeshStandardMaterial;
  readonly ledOff: THREE.MeshStandardMaterial;
  readonly rackFronts: { mat: THREE.MeshStandardMaterial; leds: { u: number; v: number; color: number }[] }[];

  constructor() {
    const brushed = brushedMetal('#7d848c');
    this.darkMetal = new THREE.MeshStandardMaterial({ color: 0x23282d, metalness: 0.75, roughness: 0.42 });
    this.steel = new THREE.MeshStandardMaterial({ color: 0xb8bec5, map: brushed, metalness: 0.9, roughness: 0.32 });
    this.blackPlastic = new THREE.MeshStandardMaterial({ color: 0x141618, metalness: 0.1, roughness: 0.55 });
    this.deskTop = new THREE.MeshStandardMaterial({ color: 0x3d434a, metalness: 0.05, roughness: 0.6 });
    this.fabric = new THREE.MeshStandardMaterial({ color: 0x1f2328, roughness: 0.95 });
    this.glass = new THREE.MeshPhysicalMaterial({ color: 0xa8c4d6, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.18, envMapIntensity: 1.2, depthWrite: false });
    this.keyboard = new THREE.MeshStandardMaterial({ map: keyboardTexture(), roughness: 0.7 });
    this.lightPanel = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f1ff, emissiveIntensity: 1.6, roughness: 1 });
    this.ledOff = new THREE.MeshStandardMaterial({ color: 0x111111 });
    this.rackFronts = [1, 2, 3].map((seed) => {
      const { map, leds } = rackFront(seed);
      return { mat: new THREE.MeshStandardMaterial({ map, metalness: 0.5, roughness: 0.5 }), leds };
    });
  }
}

const rbox = (w: number, h: number, d: number, r = 0.01) => new RoundedBoxGeometry(w, h, d, 2, r);

/** Collects blinking LEDs from all racks into a single InstancedMesh. */
export class LedField {
  private items: { pos: THREE.Vector3; color: THREE.Color; phase: number; speed: number }[] = [];
  mesh: THREE.InstancedMesh | null = null;
  add(pos: THREE.Vector3, color: number) {
    this.items.push({ pos, color: new THREE.Color(color), phase: Math.random() * 10, speed: 0.5 + Math.random() * 6 });
  }
  build(scene: THREE.Object3D) {
    const geo = new THREE.BoxGeometry(0.008, 0.006, 0.004);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.items.length);
    const m = new THREE.Matrix4();
    this.items.forEach((it, i) => { m.setPosition(it.pos); this.mesh!.setMatrixAt(i, m); this.mesh!.setColorAt(i, it.color); });
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  private c = new THREE.Color();
  update(time: number) {
    if (!this.mesh) return;
    this.items.forEach((it, i) => {
      const on = Math.sin(time * it.speed + it.phase) > -0.3;
      this.c.copy(it.color).multiplyScalar(on ? 2.2 : 0.15);
      this.mesh!.setColorAt(i, this.c);
    });
    this.mesh.instanceColor!.needsUpdate = true;
  }
}

/** 42U rack, ~0.6 x 2.0 x 1.0 m. Front faces +Z in local space. */
export function serverRack(mats: Mats, leds: LedField, variant = 0): THREE.Group {
  const g = new THREE.Group();
  const W = 0.6, H = 2.0, D = 1.0;
  const body = new THREE.Mesh(rbox(W, H, D, 0.015), mats.darkMetal);
  body.position.y = H / 2;
  g.add(body);
  const front = mats.rackFronts[variant % mats.rackFronts.length];
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.06, H - 0.12), front.mat);
  face.position.set(0, H / 2, D / 2 + 0.002);
  g.add(face);
  // perforated glass door + handle
  const door = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.03, H - 0.06), mats.glass);
  door.position.set(0, H / 2, D / 2 + 0.03);
  g.add(door);
  const handle = new THREE.Mesh(rbox(0.02, 0.22, 0.03, 0.006), mats.steel);
  handle.position.set(W / 2 - 0.05, H / 2, D / 2 + 0.045);
  g.add(handle);
  // top vent
  const vent = new THREE.Mesh(new THREE.BoxGeometry(W - 0.1, 0.01, D - 0.2), mats.blackPlastic);
  vent.position.set(0, H + 0.002, 0);
  g.add(vent);
  g.userData.ledSpecs = front.leds.map((l) => ({
    local: new THREE.Vector3((l.u - 0.5) * (W - 0.06), 0.06 + l.v * (H - 0.12), D / 2 + 0.006),
    color: l.color,
  }));
  g.userData.registerLeds = () => {
    g.updateMatrixWorld(true);
    for (const s of g.userData.ledSpecs) leds.add(s.local.clone().applyMatrix4(g.matrixWorld), s.color);
  };
  return g;
}

/** Desktop monitor. Screen faces +Z. */
export function monitor(mats: Mats, screen: ScreenTexture, width = 0.62): THREE.Group {
  const g = new THREE.Group();
  const h = width * 0.58;
  const body = new THREE.Mesh(rbox(width, h, 0.035, 0.008), mats.blackPlastic);
  body.position.y = 0.16 + h / 2;
  g.add(body);
  const scr = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.02, h - 0.025),
    new THREE.MeshStandardMaterial({ map: screen.texture, emissive: 0xffffff, emissiveMap: screen.texture, emissiveIntensity: 0.9, roughness: 0.25, metalness: 0 }),
  );
  scr.position.set(0, 0.16 + h / 2 + 0.004, 0.0185);
  g.add(scr);
  screen.anchor = scr;
  const neck = new THREE.Mesh(rbox(0.05, 0.2, 0.03, 0.008), mats.steel);
  neck.position.set(0, 0.1, -0.03);
  g.add(neck);
  const base = new THREE.Mesh(rbox(0.24, 0.012, 0.18, 0.005), mats.steel);
  base.position.set(0, 0.006, -0.01);
  g.add(base);
  g.userData.screenMesh = scr;
  return g;
}

/** Desk ~1.6 x 0.75 x 0.8 m with keyboard and mouse. Front edge (user side) at +Z. */
export function desk(mats: Mats, width = 1.6): THREE.Group {
  const g = new THREE.Group();
  const top = new THREE.Mesh(rbox(width, 0.04, 0.8, 0.012), mats.deskTop);
  top.position.y = 0.74;
  g.add(top);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(rbox(0.05, 0.72, 0.7, 0.01), mats.darkMetal);
    leg.position.set(sx * (width / 2 - 0.08), 0.36, 0);
    g.add(leg);
  }
  const modesty = new THREE.Mesh(new THREE.BoxGeometry(width - 0.2, 0.35, 0.02), mats.darkMetal);
  modesty.position.set(0, 0.5, -0.33);
  g.add(modesty);
  const kb = new THREE.Mesh(rbox(0.44, 0.018, 0.14, 0.004), mats.keyboard);
  kb.position.set(0, 0.769, 0.18);
  g.add(kb);
  const mouse = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.04, 4, 8), mats.blackPlastic);
  mouse.rotation.x = Math.PI / 2;
  mouse.scale.set(1, 1, 0.5);
  mouse.position.set(0.32, 0.772, 0.18);
  g.add(mouse);
  return g;
}

/** Office chair facing -Z (towards the desk when placed in front of it). */
export function chair(mats: Mats): THREE.Group {
  const g = new THREE.Group();
  const seat = new THREE.Mesh(rbox(0.5, 0.08, 0.48, 0.03), mats.fabric);
  seat.position.y = 0.48;
  g.add(seat);
  const back = new THREE.Mesh(rbox(0.48, 0.6, 0.07, 0.03), mats.fabric);
  back.position.set(0, 0.86, 0.24);
  back.rotation.x = -0.12;
  g.add(back);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 12), mats.steel);
  post.position.y = 0.26;
  g.add(post);
  for (let i = 0; i < 5; i++) {
    const leg = new THREE.Mesh(rbox(0.3, 0.03, 0.04, 0.01), mats.blackPlastic);
    const a = (i / 5) * Math.PI * 2;
    leg.position.set(Math.cos(a) * 0.15, 0.06, Math.sin(a) * 0.15);
    leg.rotation.y = -a;
    g.add(leg);
  }
  return g;
}

/** Screen panel for walls (video walls, mission board). Faces +Z. */
export function wallScreen(mats: Mats, screen: ScreenTexture, w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(rbox(w + 0.06, h + 0.06, 0.06, 0.01), mats.blackPlastic);
  g.add(frame);
  const scr = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: screen.texture, emissive: 0xffffff, emissiveMap: screen.texture, emissiveIntensity: 0.85, roughness: 0.3 }),
  );
  scr.position.z = 0.031;
  g.add(scr);
  screen.anchor = scr;
  g.userData.screenMesh = scr;
  return g;
}

export function newScreen(w: number, h: number, painter: Painter, interval = 0.12) {
  return new ScreenTexture(w, h, painter, interval);
}
