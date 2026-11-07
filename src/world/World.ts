import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Quality } from '../progression/save';
import type { LabId } from '../missions/types';
import { Mats, LedField, serverRack, monitor, desk, chair, wallScreen, newScreen } from './equipment';
import { concrete, floorTiles, signTexture, wallPanels } from './textures';
import { painters, painters2, SANS, type ScreenTexture } from './screens';

export interface Interactable {
  id: string;
  object: THREE.Object3D;
  actionKey: string;
}

export interface Door {
  lab: LabId;
  unlocked: boolean;
  open: number; // 0..1
  panels: THREE.Mesh[];
  closedZ: number[];
  collider: THREE.Box3;
  center: THREE.Vector3;
  statusLight: THREE.MeshStandardMaterial;
}

export interface WorldInfo {
  name: string;
  rankLabel: string;
  xp: number;
  board: { label: string; status: string; ok: boolean }[];
  welcome: string;
  rtl: boolean;
}

const LOBBY_H = 4.5;
const LAB_H = 3.6;
const T = 0.3; // wall thickness

export class World {
  readonly root = new THREE.Group();
  readonly colliders: THREE.Box3[] = [];
  readonly interactables: Interactable[] = [];
  readonly doors: Door[] = [];
  readonly spawn = new THREE.Vector3(0, 0, 7);
  private mats = new Mats();
  private leds = new LedField();
  private screens: ScreenTexture[] = [];
  private info: WorldInfo = { name: '', rankLabel: '', xp: 0, board: [], welcome: '', rtl: false };
  private infoScreens: ScreenTexture[] = [];
  private lobbyWall: THREE.MeshStandardMaterial;
  private pool: THREE.PointLight[] = [];
  private zoneLights = new Map<LabId, [number, number, number, number, number][]>();
  private zone: LabId | null = null;
  private labWall: THREE.MeshStandardMaterial;
  private trim: THREE.MeshStandardMaterial;

  constructor(private quality: Quality) {
    const wp = wallPanels('#3a4148', '#252a2f');
    wp.repeat.set(4, 1);
    this.lobbyWall = new THREE.MeshStandardMaterial({ map: wp, roughness: 0.85, metalness: 0.05 });
    const lp = wallPanels('#23292f', '#15191d');
    lp.repeat.set(3, 1);
    this.labWall = new THREE.MeshStandardMaterial({ map: lp, roughness: 0.9 });
    this.trim = new THREE.MeshStandardMaterial({ color: 0x6f7780, metalness: 0.85, roughness: 0.35 });
    this.buildLobby();
    this.buildServerHall();
    this.buildSocLab();
    this.buildOtherLabs();
    this.buildDoors();
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffffff, 0, 10, 2); this.pool.push(l); this.root.add(l); }
    this.setZone('soc');
    this.leds.build(this.root);
  }

  // ---------- helpers ----------

  private box(x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material, collide = true, parent: THREE.Object3D = this.root) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    parent.add(m);
    if (collide) this.colliders.push(new THREE.Box3().setFromCenterAndSize(m.position.clone(), new THREE.Vector3(w, h, d)));
    return m;
  }

  /** Wall running along X at fixed z, from x0 to x1, with door openings centered at given x. */
  private wallX(z: number, x0: number, x1: number, h: number, mat: THREE.Material, openings: number[] = [], ow = 1.8, oh = 2.6) {
    const cuts = [...openings].sort((a, b) => a - b);
    let cur = x0;
    for (const c of cuts) {
      const a = c - ow / 2, b = c + ow / 2;
      if (a > cur) this.box((cur + a) / 2, h / 2, z, a - cur, h, T, mat);
      this.box(c, oh + (h - oh) / 2, z, ow, h - oh, T, mat, false);
      cur = b;
    }
    if (x1 > cur) this.box((cur + x1) / 2, h / 2, z, x1 - cur, h, T, mat);
  }

  /** Wall running along Z at fixed x. */
  private wallZ(x: number, z0: number, z1: number, h: number, mat: THREE.Material, openings: number[] = [], ow = 1.8, oh = 2.6) {
    const cuts = [...openings].sort((a, b) => a - b);
    let cur = z0;
    for (const c of cuts) {
      const a = c - ow / 2, b = c + ow / 2;
      if (a > cur) this.box(x, h / 2, (cur + a) / 2, T, h, a - cur, mat);
      this.box(x, oh + (h - oh) / 2, c, T, h - oh, ow, mat, false);
      cur = b;
    }
    if (z1 > cur) this.box(x, h / 2, (cur + z1) / 2, T, h, z1 - cur, mat);
  }

  private floor(x0: number, x1: number, z0: number, z1: number, mat: THREE.Material) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
    f.rotation.x = -Math.PI / 2;
    f.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    f.receiveShadow = true;
    this.root.add(f);
  }

  private ceiling(x0: number, x1: number, z0: number, z1: number, h: number, panelsX: number, panelsZ: number) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshStandardMaterial({ color: 0x2a2f34, roughness: 0.9 }));
    c.rotation.x = Math.PI / 2;
    c.position.set((x0 + x1) / 2, h, (z0 + z1) / 2);
    this.root.add(c);
    const geo = new RoundedBoxGeometry(1.2, 0.04, 0.6, 2, 0.01);
    const sx = (x1 - x0) / panelsX, sz = (z1 - z0) / panelsZ;
    for (let i = 0; i < panelsX; i++) for (let j = 0; j < panelsZ; j++) {
      const p = new THREE.Mesh(geo, this.mats.lightPanel);
      p.position.set(x0 + sx * (i + 0.5), h - 0.02, z0 + sz * (j + 0.5));
      this.root.add(p);
    }
  }

  private light(x: number, y: number, z: number, color: number, intensity: number, distance: number) {
    const l = new THREE.PointLight(color, intensity, distance, 2);
    l.position.set(x, y, z);
    this.root.add(l);
    return l;
  }

  private spot(x: number, y: number, z: number, tx: number, tz: number, intensity: number) {
    const s = new THREE.SpotLight(0xf2f6ff, intensity, 14, Math.PI / 4.2, 0.6, 1.6);
    s.position.set(x, y, z);
    s.target.position.set(tx, 0, tz);
    const shadows = this.quality === 'high' || this.quality === 'ultra';
    s.castShadow = shadows;
    if (shadows) {
      s.shadow.mapSize.setScalar(this.quality === 'ultra' ? 2048 : 1024);
      s.shadow.bias = -0.0005;
      s.shadow.normalBias = 0.02;
    }
    this.root.add(s, s.target);
  }

  private castAll(obj: THREE.Object3D) {
    obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  private screen(w: number, h: number, painter: Parameters<typeof newScreen>[2], interval = 0.12) {
    const s = newScreen(w, h, painter, interval);
    this.screens.push(s);
    return s;
  }

  // ---------- lobby ----------

  private buildLobby() {
    const fl = concrete('#565c62');
    fl.map.repeat.set(5, 5); fl.roughnessMap.repeat.set(5, 5);
    this.floor(-10, 10, -10, 10, new THREE.MeshStandardMaterial({ map: fl.map, roughnessMap: fl.roughnessMap, roughness: 0.55, metalness: 0.15 }));
    this.ceiling(-10, 10, -10, 10, LOBBY_H, 4, 6);

    // walls
    this.wallX(-10, -10, 10, LOBBY_H, this.lobbyWall);
    this.wallZ(-10, -10, 10, LOBBY_H, this.lobbyWall, [-5, 0, 5]);
    this.wallZ(10, -10, 10, LOBBY_H, this.lobbyWall, [-5, 0, 5]);
    // south wall: solid ends + glass into the server hall
    this.box(-8, LOBBY_H / 2, 10, 4, LOBBY_H, T, this.lobbyWall);
    this.box(8, LOBBY_H / 2, 10, 4, LOBBY_H, T, this.lobbyWall);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(12, LOBBY_H), this.mats.glass);
    glass.position.set(0, LOBBY_H / 2, 10);
    glass.rotation.y = Math.PI;
    this.root.add(glass);
    this.colliders.push(new THREE.Box3(new THREE.Vector3(-6, 0, 9.9), new THREE.Vector3(6, LOBBY_H, 10.1)));
    for (const x of [-6, -3, 0, 3, 6]) this.box(x, LOBBY_H / 2, 10, 0.06, LOBBY_H, 0.08, this.trim, false);
    this.box(0, 0.05, 10, 12, 0.1, 0.12, this.trim, false);

    // skirting trim
    for (const [x, z, w, d] of [[0, -9.84, 20, 0.02], [-9.84, 0, 0.02, 20], [9.84, 0, 0.02, 20]] as const) {
      this.box(x, 0.06, z, w, 0.12, d, this.trim, false);
    }

    // columns
    for (const [x, z] of [[-6.5, -6.5], [6.5, -6.5], [-6.5, 6.5], [6.5, 6.5]]) {
      const col = new THREE.Mesh(new RoundedBoxGeometry(0.7, LOBBY_H, 0.7, 2, 0.04), this.mats.steel);
      col.position.set(x, LOBBY_H / 2, z);
      this.castAll(col);
      this.root.add(col);
      this.colliders.push(new THREE.Box3().setFromCenterAndSize(col.position.clone(), new THREE.Vector3(0.7, LOBBY_H, 0.7)));
      const ring = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.03, 0.72), new THREE.MeshStandardMaterial({ color: 0x4fa3d9, emissive: 0x4fa3d9, emissiveIntensity: 1.2 }));
      ring.position.set(x, 2.8, z);
      this.root.add(ring);
    }

    // brand video wall (north)
    const brand = this.screen(1280, 534, (g, w, h, t) => this.paintBrand(g, w, h, t), 0.2);
    this.infoScreens.push(brand);
    const bw = wallScreen(this.mats, brand, 6, 2.5);
    bw.position.set(0, 2.55, -9.82);
    this.root.add(bw);

    // reception counter
    const counter = new THREE.Group();
    const top = new THREE.Mesh(new RoundedBoxGeometry(3.6, 0.06, 0.9, 2, 0.02), new THREE.MeshStandardMaterial({ color: 0xd9dde0, roughness: 0.25, metalness: 0.05 }));
    top.position.y = 1.08;
    const front = new THREE.Mesh(new RoundedBoxGeometry(3.5, 1.05, 0.7, 2, 0.03), this.mats.steel);
    front.position.y = 0.525;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.02, 0.01), new THREE.MeshStandardMaterial({ color: 0x4fa3d9, emissive: 0x4fa3d9, emissiveIntensity: 1.5 }));
    strip.position.set(0, 0.85, 0.355);
    counter.add(top, front, strip);
    counter.position.set(0, 0, -5.6);
    this.castAll(counter);
    this.root.add(counter);
    this.colliders.push(new THREE.Box3(new THREE.Vector3(-1.8, 0, -6.05), new THREE.Vector3(1.8, 1.2, -5.15)));
    const welcome = this.screen(768, 448, (g, w, h) => this.paintWelcome(g, w, h), 0);
    this.infoScreens.push(welcome);
    const recMon = monitor(this.mats, welcome, 0.55);
    recMon.position.set(0, 1.11, -5.55);
    this.castAll(recMon);
    this.root.add(recMon);
    this.interactables.push({ id: 'reception', object: recMon, actionKey: 'act.reception' });

    // mission board (north wall, left)
    const board = this.screen(1024, 680, (g, w, h) => this.paintBoard(g, w, h), 0);
    this.infoScreens.push(board);
    const bb = wallScreen(this.mats, board, 2.4, 1.6);
    bb.position.set(-6.4, 1.9, -9.82);
    this.root.add(bb);
    this.interactables.push({ id: 'board', object: bb, actionKey: 'act.board' });

    // profile kiosk (north wall, right)
    const kiosk = new THREE.Group();
    const post = new THREE.Mesh(new RoundedBoxGeometry(0.5, 1.1, 0.35, 2, 0.04), this.mats.darkMetal);
    post.position.y = 0.55;
    kiosk.add(post);
    const kScreen = this.screen(512, 640, (g, w, h) => this.paintProfile(g, w, h), 0);
    this.infoScreens.push(kScreen);
    const kMon = monitor(this.mats, kScreen, 0.5);
    kMon.scale.set(1, 1.4, 1);
    kMon.position.set(0, 0.95, 0.05);
    kMon.rotation.x = -0.2;
    kiosk.add(kMon);
    kiosk.position.set(6.4, 0, -9.2);
    this.castAll(kiosk);
    this.root.add(kiosk);
    this.colliders.push(new THREE.Box3(new THREE.Vector3(6.1, 0, -9.5), new THREE.Vector3(6.7, 1.5, -8.9)));
    this.interactables.push({ id: 'profile', object: kiosk, actionKey: 'act.profile' });

    // benches
    for (const x of [-3.2, 3.2]) {
      const bench = new THREE.Group();
      const seat = new THREE.Mesh(new RoundedBoxGeometry(2.2, 0.08, 0.6, 2, 0.03), new THREE.MeshStandardMaterial({ color: 0x5b4a3c, roughness: 0.55 }));
      seat.position.y = 0.45;
      bench.add(seat);
      for (const sx of [-0.9, 0.9]) {
        const leg = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.42, 0.5, 2, 0.01), this.mats.darkMetal);
        leg.position.set(sx, 0.21, 0);
        bench.add(leg);
      }
      bench.position.set(x, 0, 4.2);
      this.castAll(bench);
      this.root.add(bench);
      this.colliders.push(new THREE.Box3(new THREE.Vector3(x - 1.1, 0, 3.9), new THREE.Vector3(x + 1.1, 0.5, 4.5)));
    }

    // lighting
    this.root.add(new THREE.HemisphereLight(0xcfe3ff, 0x2a2622, 0.35));
    for (const [x, z] of [[-5, -4], [5, -4], [0, 5]]) this.light(x, LOBBY_H - 0.3, z, 0xf0f4ff, 14, 16);
    this.spot(0, LOBBY_H - 0.1, -2, 0, -5.6, 40);
  }

  // ---------- server hall behind glass ----------

  private buildServerHall() {
    const ft = floorTiles('#2f353a');
    ft.map.repeat.set(10, 3.3); ft.roughnessMap.repeat.set(10, 3.3);
    this.floor(-6, 6, 10, 14, new THREE.MeshStandardMaterial({ map: ft.map, roughnessMap: ft.roughnessMap, metalness: 0.3 }));
    this.wallX(14, -6, 6, LOBBY_H, this.labWall);
    this.box(-6, LOBBY_H / 2, 12, T, LOBBY_H, 4, this.labWall, false);
    this.box(6, LOBBY_H / 2, 12, T, LOBBY_H, 4, this.labWall, false);
    const c = new THREE.Mesh(new THREE.PlaneGeometry(12, 4), new THREE.MeshStandardMaterial({ color: 0x15181b }));
    c.rotation.x = Math.PI / 2; c.position.set(0, LOBBY_H, 12);
    this.root.add(c);
    for (let i = 0; i < 16; i++) {
      const r = serverRack(this.mats, this.leds, i);
      r.position.set(-4.65 + i * 0.62, 0, 13.0);
      r.rotation.y = Math.PI;
      this.root.add(r);
      r.userData.registerLeds();
    }
    // cable tray
    this.box(0, 2.35, 13.0, 10.2, 0.06, 0.4, this.mats.darkMetal, false);
    this.light(0, 3.6, 11.5, 0x5aaaf0, 9, 10);
  }

  // ---------- SOC lab ----------

  private buildSocLab() {
    const x0 = -22, x1 = -10, z0 = -13, z1 = -2.4;
    const ft = floorTiles('#353b41');
    ft.map.repeat.set(10, 8.8); ft.roughnessMap.repeat.set(10, 8.8);
    this.floor(x0, x1, z0, z1, new THREE.MeshStandardMaterial({ map: ft.map, roughnessMap: ft.roughnessMap, metalness: 0.25 }));
    this.ceiling(x0, x1, z0, z1, LAB_H, 3, 4);
    this.wallX(z0, x0, x1, LAB_H, this.labWall);
    this.wallX(z1, x0, x1, LAB_H, this.labWall);
    this.wallZ(x0, z0, z1, LAB_H, this.labWall);
    // gap between lab and lobby wall (lobby wall covers -10..10)
    this.box(-10, LAB_H / 2, -11.5, T, LAB_H, 3, this.labWall);

    // video wall on west wall
    const dash = wallScreen(this.mats, this.screen(1024, 576, painters.dashboard(), 0.3), 3.4, 1.9);
    dash.position.set(-21.82, 2.15, -7.7);
    dash.rotation.y = Math.PI / 2;
    this.root.add(dash);
    const logs = wallScreen(this.mats, this.screen(768, 480, painters.logs('srv-web-01 — auth.log'), 0.4), 2.0, 1.25);
    logs.position.set(-21.82, 2.15, -10.55);
    logs.rotation.y = Math.PI / 2;
    this.root.add(logs);
    const topo = wallScreen(this.mats, this.screen(768, 480, painters.topology(), 0.1), 2.0, 1.25);
    topo.position.set(-21.82, 2.15, -4.85);
    topo.rotation.y = Math.PI / 2;
    this.root.add(topo);

    // analyst desks, users face -X (towards the video wall)
    const deskSpots: [number, number, boolean][] = [[-16, -10.2, false], [-16, -7.6, false], [-16, -5, true]];
    for (const [x, z, main] of deskSpots) {
      const g = new THREE.Group();
      const d = desk(this.mats, 1.9);
      g.add(d);
      const mons: [number, Parameters<typeof newScreen>[2]][] = main
        ? [[-0.62, painters.dashboard()], [0, painters.logs('terminal — analyst@srv-web-01')], [0.62, painters.topology()]]
        : [[-0.33, painters.idle('SOC-0' + (z < -9 ? 1 : 2))], [0.33, painters.logs('siem — live')]];
      for (const [mx, p] of mons) {
        const m = monitor(this.mats, this.screen(640, 384, p, main ? 0.25 : 0.6), 0.58);
        m.position.set(mx, 0.76, -0.2);
        m.rotation.y = -mx * 0.35;
        g.add(m);
      }
      const ch = chair(this.mats);
      ch.position.set(0, 0, 0.75);
      g.add(ch);
      g.position.set(x, 0, z);
      g.rotation.y = Math.PI / 2;
      this.castAll(g);
      this.root.add(g);
      this.colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.42, 0, z - 0.95), new THREE.Vector3(x + 0.42, 1.3, z + 0.95)));
      if (main) this.interactables.push({ id: 'lab:soc', object: g, actionKey: 'act.terminal' });
    }

    // racks along north wall (7) and south wall (6)
    for (let i = 0; i < 7; i++) {
      const r = serverRack(this.mats, this.leds, i + 3);
      r.position.set(-21.2 + i * 0.62, 0, -12.35);
      this.root.add(r);
      r.userData.registerLeds();
      if (i < 6) {
        const r2 = serverRack(this.mats, this.leds, i + 5);
        r2.position.set(-21.2 + i * 0.62, 0, -3.05);
        r2.rotation.y = Math.PI;
        this.root.add(r2);
        r2.userData.registerLeds();
      }
    }
    this.colliders.push(new THREE.Box3(new THREE.Vector3(-21.6, 0, -12.85), new THREE.Vector3(-16.9, 2.1, -11.8)));
    this.colliders.push(new THREE.Box3(new THREE.Vector3(-21.6, 0, -3.6), new THREE.Vector3(-17.5, 2.1, -2.5)));

    this.zoneLights.set('soc', [[-15, LAB_H - 0.3, -9.5, 0xdfe8ff, 7], [-13, LAB_H - 0.3, -4.5, 0xdfe8ff, 6], [-20.5, 2.4, -7.7, 0x4f8fd9, 4]]);
    this.spot(-15.5, LAB_H - 0.1, -5, -16, -5, 30);
  }


  // ---------- other labs ----------

  /** Floor, ceiling and the walls a lab owns. */
  private labShell(x0: number, x1: number, z0: number, z1: number, walls: { north?: boolean; south?: boolean; outerX: number }, floorTint: string) {
    const ft = floorTiles(floorTint);
    ft.map.repeat.set((x1 - x0) / 1.2, (z1 - z0) / 1.2); ft.roughnessMap.repeat.copy(ft.map.repeat);
    this.floor(x0, x1, z0, z1, new THREE.MeshStandardMaterial({ map: ft.map, roughnessMap: ft.roughnessMap, metalness: 0.25 }));
    this.ceiling(x0, x1, z0, z1, LAB_H, Math.max(1, Math.round((x1 - x0) / 4.5)), Math.max(1, Math.round((z1 - z0) / 3.5)));
    if (walls.north) this.wallX(z0, x0, x1, LAB_H, this.labWall);
    if (walls.south) this.wallX(z1, x0, x1, LAB_H, this.labWall);
    this.wallZ(walls.outerX, z0, z1, LAB_H, this.labWall);
  }

  /** Desk with monitors and chair. rotY turns the whole station; the user side is local +Z. */
  private station(x: number, z: number, rotY: number, monitors: Parameters<typeof newScreen>[2][], interactId?: string, actionKey?: string, interval = 0.5) {
    const g = new THREE.Group();
    g.add(desk(this.mats, 1.9));
    const n = monitors.length;
    monitors.forEach((p, i) => {
      const mx = (i - (n - 1) / 2) * 0.62;
      const m = monitor(this.mats, this.screen(640, 384, p, interval), 0.58);
      m.position.set(mx, 0.76, -0.2);
      m.rotation.y = -mx * 0.35;
      g.add(m);
    });
    const ch = chair(this.mats);
    ch.position.set(0, 0, 0.75);
    g.add(ch);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.castAll(g);
    this.root.add(g);
    const along = Math.abs(Math.sin(rotY)) > 0.5; // desk width runs along z
    this.colliders.push(new THREE.Box3(new THREE.Vector3(x - (along ? 0.42 : 0.95), 0, z - (along ? 0.95 : 0.42)), new THREE.Vector3(x + (along ? 0.42 : 0.95), 1.3, z + (along ? 0.95 : 0.42))));
    if (interactId) this.interactables.push({ id: interactId, object: g, actionKey: actionKey! });
    return g;
  }

  /** A row of racks. Facing: rotation of each rack (0 = front faces +Z). */
  private rackRow(x: number, z: number, count: number, dir: 'x' | 'z', rotY: number, seed = 0) {
    for (let i = 0; i < count; i++) {
      const r = serverRack(this.mats, this.leds, i + seed);
      r.position.set(dir === 'x' ? x + i * 0.62 : x, 0, dir === 'z' ? z + i * 0.62 : z);
      r.rotation.y = rotY;
      this.root.add(r);
      r.userData.registerLeds();
    }
    const len = (count - 1) * 0.62;
    const half = Math.abs(Math.sin(rotY)) > 0.5 ? [0.5, 0.3] : [0.3, 0.5];
    const [hx, hz] = dir === 'x' ? [half[0], half[1]] : [half[0], half[1]];
    const minX = dir === 'x' ? x - 0.3 : x - hx, maxX = dir === 'x' ? x + len + 0.3 : x + hx;
    const minZ = dir === 'z' ? z - 0.3 : z - hz, maxZ = dir === 'z' ? z + len + 0.3 : z + hz;
    this.colliders.push(new THREE.Box3(new THREE.Vector3(minX, 0, minZ), new THREE.Vector3(maxX, 2.1, maxZ)));
  }

  private wallDisplay(x: number, z: number, rotY: number, w: number, h: number, painter: Parameters<typeof newScreen>[2], px = 1024, interval = 0.3) {
    const s = wallScreen(this.mats, this.screen(px, Math.round((px * h) / w), painter, interval), w, h);
    s.position.set(x, 2.0, z);
    s.rotation.y = rotY;
    this.root.add(s);
  }

  private buildOtherLabs() {
    const W = -Math.PI / 2, E = Math.PI / 2;
    // fill the lobby side walls beyond the lobby (z -13..-10 and 10..13)
    this.box(-10, LAB_H / 2, 11.5, T, LAB_H, 3, this.labWall);
    this.box(10, LAB_H / 2, -11.5, T, LAB_H, 3, this.labWall);
    this.box(10, LAB_H / 2, 11.5, T, LAB_H, 3, this.labWall);

    // NETWORK (west, z -2.4..2.6): wiring closet with racks and a console bench
    this.labShell(-22, -10, -2.4, 2.6, { south: true, outerX: -22 }, '#323a33');
    this.rackRow(-21.2, -1.75, 7, 'x', 0, 2);
    const bench = this.station(-14.5, 1.75, Math.PI, [painters2.ios(), painters2.ios()], 'lab:network', 'act.network', 0.5);
    const sw = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.045, 0.3, 2, 0.006), this.mats.rackFronts[0].mat);
    sw.position.set(0.62, 0.785, 0.05);
    bench.add(sw);
    this.zoneLights.set('network', [[-14, LAB_H - 0.3, 0.2, 0xe6ffe9, 6], [-19, LAB_H - 0.3, 0.2, 0xdfe8ff, 5], [-21, 2.2, -1.2, 0x3ad07a, 2.5]]);

    // CODING (west, z 2.6..13): developer floor
    this.labShell(-22, -10, 2.6, 13, { south: true, outerX: -22 }, '#36343c');
    this.station(-15, 5, E, [painters2.code(), painters2.code()], 'lab:coding', 'act.coding', 2);
    this.station(-15, 8.3, E, [painters2.code(), painters.idle('CI #4812 passed')], undefined, undefined, 2);
    this.station(-15, 11.4, E, [painters2.code()], undefined, undefined, 2);
    this.station(-19.2, 6.6, E, [painters2.code(), painters2.code()], undefined, undefined, 2);
    this.station(-19.2, 9.9, E, [painters.idle('code review')], undefined, undefined, 2);
    this.wallDisplay(-21.82, 7.8, E, 3.2, 1.6, painters2.code(), 1024, 0);
    this.zoneLights.set('coding', [[-14, LAB_H - 0.3, 6, 0xf2ecff, 7], [-19, LAB_H - 0.3, 9, 0xf2ecff, 6], [-21, 2.4, 7.8, 0x9d7cf0, 3]]);

    // CLOUD (east, z -13..-2.4): data hall with two rack rows and a NOC desk
    this.labShell(10, 22, -13, -2.4, { north: true, south: true, outerX: 22 }, '#30383f');
    this.rackRow(15.3, -11.9, 10, 'x', 0, 4);
    this.rackRow(15.3, -9.3, 10, 'x', Math.PI, 7);
    this.station(13.2, -6.3, W, [painters2.cloud(), painters2.cloud(), painters.dashboard()], 'lab:cloud', 'act.cloud', 0.5);
    this.wallDisplay(21.82, -5.2, W, 3.0, 1.6, painters2.cloud(), 1024, 0.4);
    this.zoneLights.set('cloud', [[14, LAB_H - 0.3, -6, 0xe0f4ff, 6], [18, LAB_H - 0.3, -10.6, 0x7fc8ff, 6], [21, 2.4, -5.2, 0x3ac8d9, 3]]);

    // FORENSICS (east, z -2.4..2.6): evidence lockers, board and workstation
    this.labShell(10, 22, -2.4, 2.6, { south: true, outerX: 22 }, '#3a3631');
    const lockerMat = new THREE.MeshStandardMaterial({ color: 0x6b7178, metalness: 0.7, roughness: 0.4, map: this.mats.steel.map });
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
      const b = new THREE.Mesh(new RoundedBoxGeometry(0.58, 0.58, 0.5, 2, 0.01), lockerMat);
      b.position.set(12.2 + i * 0.62, 0.32 + j * 0.62, -1.95);
      this.castAll(b);
      this.root.add(b);
    }
    this.colliders.push(new THREE.Box3(new THREE.Vector3(11.9, 0, -2.25), new THREE.Vector3(15.6, 2, -1.65)));
    this.wallDisplay(21.82, 0.1, W, 3.2, 1.8, painters2.evidence(), 1024, 0);
    this.station(17, 1.7, Math.PI, [painters2.hashes(), painters2.hashes()], 'lab:forensics', 'act.forensics', 0);
    this.zoneLights.set('forensics', [[14, LAB_H - 0.3, 0, 0xfff1dc, 6], [19, LAB_H - 0.3, 0.5, 0xfff1dc, 6], [21, 2.6, 0.1, 0xd9a441, 2.5]]);

    // CRYPTO (east, z 2.6..13): dark analysis room with a hex wall
    this.labShell(10, 22, 2.6, 13, { south: true, outerX: 22 }, '#2c2d34');
    this.wallDisplay(21.82, 6, W, 2.4, 1.4, painters2.hex(), 768, 0.35);
    this.wallDisplay(21.82, 8.8, W, 2.4, 1.4, painters2.hex(), 768, 0.35);
    this.station(17.5, 6.8, W, [painters2.hex(), painters.logs('decoder — layers'), painters2.hex()], 'lab:crypto', 'act.crypto', 0.6);
    this.rackRow(12.5, 12.3, 4, 'x', Math.PI, 9);
    this.zoneLights.set('crypto', [[16, LAB_H - 0.3, 6.5, 0xd8d0ff, 4], [19, LAB_H - 0.3, 10, 0xb9a6ff, 3], [21, 2.4, 7.4, 0xc792ea, 3]]);
  }

  private zoneAt(p: THREE.Vector3): LabId | null {
    const west = p.x < -9.9, east = p.x > 9.9;
    if (!west && !east) {
      // in the lobby: pre-light the lab whose door is closest
      let best: LabId | null = null, bd = 7;
      for (const d of this.doors) { const dist = Math.hypot(p.x - d.center.x, p.z - d.center.z); if (dist < bd) { bd = dist; best = d.lab; } }
      return best;
    }
    const z = p.z;
    if (west) return z < -2.4 ? 'soc' : z < 2.6 ? 'network' : 'coding';
    return z < -2.4 ? 'cloud' : z < 2.6 ? 'forensics' : 'crypto';
  }

  private setZone(z: LabId | null) {
    if (!z || z === this.zone) return;
    this.zone = z;
    const spots = this.zoneLights.get(z) ?? [];
    this.pool.forEach((l, i) => {
      const s = spots[i];
      if (!s) { l.intensity = 0; return; }
      l.position.set(s[0], s[1], s[2]); l.color.setHex(s[3]); l.intensity = s[4]; l.distance = 11;
    });
  }

  // ---------- doors ----------

  private buildDoors() {
    const labs: [LabId, number, number][] = [
      ['soc', -10, -5], ['network', -10, 0], ['coding', -10, 5],
      ['cloud', 10, -5], ['forensics', 10, 0], ['crypto', 10, 5],
    ];
    const names: Record<LabId, [string, string]> = {
      soc: ['SOC & Incident Response', 'مركز العمليات الأمنية'],
      network: ['Network Security', 'أمن الشبكات'],
      coding: ['Secure Coding', 'البرمجة الآمنة'],
      cloud: ['Cloud Security', 'أمن السحابة'],
      forensics: ['Digital Forensics', 'التحقيق الجنائي الرقمي'],
      crypto: ['Cryptography & CTF', 'التشفير وتحديات CTF'],
    };
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 0.85, roughness: 0.3, map: this.mats.steel.map });
    for (const [lab, x, z] of labs) {
      const side = x < 0 ? 1 : -1; // direction into the lobby (+x for west wall)
      const panels: THREE.Mesh[] = [];
      for (const s of [-1, 1]) {
        const p = new THREE.Mesh(new RoundedBoxGeometry(0.06, 2.58, 0.9, 2, 0.01), panelMat);
        p.position.set(x, 1.29, z + s * 0.45);
        this.castAll(p);
        this.root.add(p);
        panels.push(p);
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 1.2), this.mats.glass);
        win.position.set(side * 0.035, 0.25, -s * 0.25);
        win.rotation.y = side * Math.PI / 2;
        p.add(win);
      }
      // frame
      for (const s of [-1, 1]) this.box(x + side * 0.16, 1.32, z + s * 0.95, 0.04, 2.64, 0.1, this.trim, false);
      this.box(x + side * 0.16, 2.66, z, 0.04, 0.08, 2.0, this.trim, false);
      const statusLight = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x3ad07a, emissiveIntensity: 2 });
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 1.6), statusLight);
      strip.position.set(x + side * 0.19, 2.56, z);
      this.root.add(strip);
      // bilingual sign above door
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(2.0, 0.5),
        new THREE.MeshStandardMaterial({
          map: signTexture([
            { text: names[lab][0], font: `600 64px ${SANS}`, color: '#e6edf2' },
            { text: names[lab][1], font: `500 56px ${SANS}`, color: '#9fb3c4', dir: 'rtl' },
          ]),
          emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.5,
        }),
      );
      sign.material.emissiveMap = (sign.material as THREE.MeshStandardMaterial).map;
      sign.position.set(x + side * 0.17, 3.2, z);
      sign.rotation.y = side * Math.PI / 2;
      this.root.add(sign);
      const collider = new THREE.Box3(new THREE.Vector3(x - 0.15, 0, z - 0.9), new THREE.Vector3(x + 0.15, 2.6, z + 0.9));
      this.colliders.push(collider);
      const door: Door = { lab, unlocked: true, open: 0, panels, closedZ: panels.map((p) => p.position.z), collider, center: new THREE.Vector3(x, 1.3, z), statusLight };
      this.doors.push(door);
      this.interactables.push({ id: 'door:' + lab, object: panels[0], actionKey: 'door' });
      this.interactables.push({ id: 'door:' + lab, object: panels[1], actionKey: 'door' });
    }
  }

  // ---------- painters for info screens ----------

  setInfo(info: WorldInfo) {
    this.info = info;
    this.infoScreens.forEach((s) => s.paint(performance.now() / 1000));
  }

  private paintBrand(g: CanvasRenderingContext2D, w: number, h: number, t: number) {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#0b141c'); grd.addColorStop(1, '#0f1d2a');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    // subtle grid
    g.strokeStyle = 'rgba(79,163,217,0.07)'; g.lineWidth = 1;
    for (let x = 0; x < w; x += 48) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    // shield mark
    g.save(); g.translate(w / 2, h * 0.3); g.strokeStyle = '#4fa3d9'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(0, -70); g.lineTo(60, -45); g.lineTo(52, 30); g.lineTo(0, 72); g.lineTo(-52, 30); g.lineTo(-60, -45); g.closePath(); g.stroke();
    g.fillStyle = '#4fa3d9'; g.fillRect(-4, -30, 8, 50); g.beginPath(); g.arc(0, -36, 14, 0, Math.PI * 2); g.lineWidth = 6; g.stroke(); g.restore();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#e8eef3'; g.font = `600 112px ${SANS}`;
    g.fillText('NEXUS Cyber Academy', w / 2, h * 0.6);
    g.fillStyle = '#8fa5b6'; g.font = `500 52px ${SANS}`; (g as any).direction = 'rtl';
    g.fillText('أكاديمية نيكسس للأمن السيبراني', w / 2, h * 0.75);
    (g as any).direction = 'ltr';
    // ticker
    g.fillStyle = '#0a1016'; g.fillRect(0, h - 64, w, 64);
    g.fillStyle = '#9fb3c4'; g.font = `30px ${SANS}`; g.textAlign = 'left';
    const msg = 'SOC: active incident on srv-web-01   •   Network: unknown device on SW-ACCESS-01 Fa0/7   •   Cloud: bucket exposure reported   •   Forensics: case 2291 integrity check   •   All scenarios are simulated   •   ';
    const mw = g.measureText(msg).width;
    const off = (t * 90) % mw;
    g.fillText(msg + msg, -off, h - 32);
  }

  private paintWelcome(g: CanvasRenderingContext2D, w: number, h: number) {
    g.fillStyle = '#0c141b'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#4fa3d9'; g.fillRect(0, 0, w, 8);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    (g as any).direction = this.info.rtl ? 'rtl' : 'ltr';
    g.fillStyle = '#e6edf2'; g.font = `600 52px ${SANS}`;
    g.fillText(this.info.name || '—', w / 2, h * 0.3);
    g.fillStyle = '#8fd6a8'; g.font = `500 32px ${SANS}`;
    g.fillText(this.info.rankLabel + ' · ' + this.info.xp + ' XP', w / 2, h * 0.47);
    g.fillStyle = '#9fb3c4'; g.font = `26px ${SANS}`;
    wrap(g, this.info.welcome, w / 2, h * 0.68, w - 80, 34);
    (g as any).direction = 'ltr';
  }

  private paintBoard(g: CanvasRenderingContext2D, w: number, h: number) {
    g.fillStyle = '#0b1117'; g.fillRect(0, 0, w, h);
    (g as any).direction = this.info.rtl ? 'rtl' : 'ltr';
    const start = this.info.rtl ? w - 40 : 40;
    const end = this.info.rtl ? 40 : w - 40;
    g.textBaseline = 'middle';
    g.textAlign = this.info.rtl ? 'right' : 'left';
    g.fillStyle = '#e6edf2'; g.font = `600 44px ${SANS}`;
    g.fillText(this.info.board.length ? (this.info.rtl ? 'لوحة المهام' : 'Mission board') : '', start, 52);
    this.info.board.forEach((row, i) => {
      const y = 130 + i * 88;
      g.fillStyle = i % 2 ? '#0f171e' : '#121c24';
      g.fillRect(20, y - 38, w - 40, 76);
      g.textAlign = this.info.rtl ? 'right' : 'left';
      g.fillStyle = '#d4dde4'; g.font = `500 32px ${SANS}`;
      g.fillText(row.label, start, y);
      g.textAlign = this.info.rtl ? 'left' : 'right';
      g.fillStyle = row.ok ? '#3ad07a' : '#d9a441'; g.font = `500 28px ${SANS}`;
      g.fillText(row.status, end, y);
    });
    (g as any).direction = 'ltr';
  }

  private paintProfile(g: CanvasRenderingContext2D, w: number, h: number) {
    g.fillStyle = '#0c141b'; g.fillRect(0, 0, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.strokeStyle = '#4fa3d9'; g.lineWidth = 6;
    g.beginPath(); g.arc(w / 2, h * 0.28, 70, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#4fa3d9'; g.font = `600 64px ${SANS}`;
    g.fillText((this.info.name || '?').slice(0, 1).toUpperCase(), w / 2, h * 0.28);
    (g as any).direction = this.info.rtl ? 'rtl' : 'ltr';
    g.fillStyle = '#e6edf2'; g.font = `600 40px ${SANS}`;
    g.fillText(this.info.name || '—', w / 2, h * 0.55);
    g.fillStyle = '#8fd6a8'; g.font = `500 30px ${SANS}`;
    g.fillText(this.info.rankLabel, w / 2, h * 0.66);
    g.fillStyle = '#9fb3c4'; g.font = `28px ${SANS}`;
    g.fillText(this.info.xp + ' XP', w / 2, h * 0.76);
    (g as any).direction = 'ltr';
  }

  // ---------- per-frame ----------

  private frustum = new THREE.Frustum();
  private tmpM = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();
  private sphere = new THREE.Sphere();

  update(time: number, dt: number, player: THREE.Vector3, camera: THREE.Camera): string | null {
    this.tmpM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.tmpM);
    const camPos = camera.position;
    const visible = (o: THREE.Object3D) => {
      o.getWorldPosition(this.tmpV);
      if (this.tmpV.distanceToSquared(camPos) > 15 * 15) return false;
      this.sphere.set(this.tmpV, 2);
      return this.frustum.intersectsSphere(this.sphere);
    };
    for (const s of this.screens) s.update(time, visible);
    this.setZone(this.zoneAt(player));
    this.leds.update(time);
    let opened: string | null = null;
    for (const d of this.doors) {
      const near = d.unlocked && Math.hypot(player.x - d.center.x, player.z - d.center.z) < 2.6;
      const target = near ? 1 : 0;
      const prev = d.open;
      d.open += Math.sign(target - d.open) * Math.min(Math.abs(target - d.open), dt * 2.2);
      if (prev === 0 && d.open > 0) opened = d.lab;
      d.panels.forEach((p, i) => { p.position.z = d.closedZ[i] + (i === 0 ? -1 : 1) * 0.88 * easeInOut(d.open); });
      // collider active unless mostly open
      const idx = this.colliders.indexOf(d.collider);
      if (d.open > 0.85 && idx >= 0) this.colliders.splice(idx, 1);
      else if (d.open <= 0.85 && idx < 0) this.colliders.push(d.collider);
    }
    return opened;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}

const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number) {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (g.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
  }
  if (cur) lines.push(cur);
  lines.forEach((l, i) => g.fillText(l, x, y + (i - (lines.length - 1) / 2) * lineH));
}
