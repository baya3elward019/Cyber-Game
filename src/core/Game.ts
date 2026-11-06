import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { World, type Interactable } from '../world/World';
import { Player } from '../player/Player';
import { UI } from '../ui/UI';
import { MissionRun, MissionUI } from '../ui/MissionUI';
import { Sfx } from '../audio/Sfx';
import { t, setLang } from '../i18n';
import { CONFIG } from './config';
import { loadSave, writeSave, exportSave, importSave, type SaveData, type Lang, type Quality, type Settings } from '../progression/save';
import { computeXp, recordCompletion, rankFor, totalXp, evaluateAchievements } from '../progression/progress';
import { missionById, missionsInLab, MISSIONS } from '../missions/registry';

type State = 'menu' | 'playing' | 'paused' | 'mission';

const PIXEL_RATIO: Record<Quality, number> = { low: 1, medium: 1.25, high: 1.5, ultra: 2 };

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 120);
  private world: World;
  private player: Player;
  private ui = new UI();
  private sfx = new Sfx();
  private save: SaveData;
  private state: State = 'menu';
  private clock = new THREE.Clock();
  private raycaster = new THREE.Raycaster();
  private target: Interactable | null = null;
  private interactMap = new Map<THREE.Object3D, Interactable>();
  private runs = new Map<string, MissionRun>();
  private missionUI: MissionUI | null = null;
  private reopen: (() => void) | null = null;
  private dev = new URLSearchParams(location.search).has('dev');
  private fps = { frames: 0, acc: 0, value: 0 };
  private lastSave = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const loaded = loadSave();
    this.save = loaded.data;
    setLang(this.save.lang);

    const q = this.save.settings.quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, PIXEL_RATIO[q]));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = q === 'high' || q === 'ultra';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    this.scene.background = new THREE.Color(0x0b0f13);
    this.scene.fog = new THREE.Fog(0x0b0f13, 28, 60);

    this.world = new World(q);
    this.scene.add(this.world.root);
    for (const it of this.world.interactables) this.interactMap.set(it.object, it);

    this.player = new Player(this.camera, this.save.settings);
    this.player.place(this.world.spawn, 0);
    this.player.onStep = (s) => this.sfx.step(s);
    this.sfx.setVolumes(this.save.settings);

    this.refreshWorldInfo();
    this.ui.setXp(this.save);
    this.bindInput();
    this.showMenu(loaded.recovered ? t('menu.resetCorrupt') : undefined);

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
    addEventListener('beforeunload', () => this.persist());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.persist(); });

    this.renderer.setAnimationLoop(() => this.frame());
    if (this.dev) (window as any).__nexus = this; // debugging hook, only with ?dev=1
  }

  // ---------- persistence ----------

  private persist() {
    if (!writeSave(this.save)) this.ui.toast(t('toast.saveFailed'), 'bad');
    this.lastSave = performance.now();
  }

  // ---------- views ----------

  private view(fn: () => void) { this.reopen = fn; fn(); }

  private showMenu(notice?: string) {
    this.state = 'menu';
    this.player.enabled = false;
    this.ui.showHud(false);
    this.view(() => this.ui.showMenu(this.save, {
      start: () => { this.sfx.unlock(); this.sfx.ui(); this.save.nickname ? this.enterGame() : this.showNickname(); },
      settings: () => this.showSettings(() => this.showMenu()),
      progress: () => this.showProgress(() => this.showMenu()),
      controls: () => this.view(() => this.ui.showControls(() => this.showMenu())),
      credits: () => this.view(() => this.ui.showCredits(() => this.showMenu())),
      setLang: (l) => this.changeLang(l),
    }, notice));
  }

  private showNickname() {
    this.view(() => this.ui.showNickname(this.save.nickname, (name) => {
      this.save.nickname = name;
      this.persist();
      this.refreshWorldInfo();
      this.enterGame();
    }, () => this.showMenu()));
  }

  private showSettings(back: () => void) {
    this.view(() => this.ui.showSettings(this.save.settings, (s) => this.applySettings(s), (l) => this.changeLang(l), back));
  }

  private showProgress(back: () => void) {
    this.view(() => this.ui.showProgress(this.save, () => this.exportProgress(), (f) => this.importProgress(f, back), back));
  }

  private applySettings(s: Settings) {
    this.save.settings = s;
    this.player.settings = s;
    this.sfx.setVolumes(s);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, PIXEL_RATIO[s.quality]));
    this.persist();
  }

  private changeLang(l: Lang) {
    this.save.lang = l;
    setLang(l);
    this.persist();
    this.refreshWorldInfo();
    this.ui.setXp(this.save);
    this.updateObjective();
    this.reopen?.();
  }

  private exportProgress() {
    const blob = new Blob([exportSave(this.save)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nexus-progress-${(this.save.nickname || 'player').replace(/[^\w-]/g, '_')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private async importProgress(file: File, back: () => void) {
    const data = importSave(await file.text());
    if (!data) { this.ui.toast(t('toast.importFailed'), 'bad'); return; }
    this.save = data;
    setLang(data.lang);
    this.applySettings(data.settings);
    this.runs.clear();
    this.refreshWorldInfo();
    this.ui.setXp(this.save);
    this.updateObjective();
    this.ui.toast(t('toast.imported'), 'ok');
    this.showProgress(back);
  }

  // ---------- gameplay state ----------

  private enterGame() {
    this.ui.closeModal();
    this.reopen = null;
    this.state = 'playing';
    this.ui.showHud(true);
    this.ui.setXp(this.save);
    this.updateObjective();
    this.player.enabled = true;
    this.lock();
  }

  private lock() {
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => { if (this.state === 'playing') this.pause(); });
    } catch { this.pause(); }
  }

  private pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.player.enabled = false;
    this.player.clearInput();
    this.ui.setPrompt(null);
    const show = () => this.view(() => this.ui.showPause({
      resume: () => this.enterGame(),
      settings: () => this.showSettings(show),
      progress: () => this.showProgress(show),
      controls: () => this.view(() => this.ui.showControls(show)),
      menu: () => { this.persist(); this.showMenu(); },
    }));
    show();
  }

  private updateObjective(big = false) {
    const nextMission = MISSIONS.find((m) => !this.save.missions[m.id]?.completed);
    this.ui.setObjective(nextMission ? t('objective.goSoc') : t('objective.allDone'), big);
  }

  private refreshWorldInfo() {
    const xp = totalXp(this.save);
    this.world.setInfo({
      name: this.save.nickname,
      rankLabel: t('rank.' + rankFor(xp).id),
      xp,
      rtl: this.save.lang === 'ar',
      welcome: t('reception.welcome', { name: this.save.nickname || '…' }),
      board: CONFIG.labs.map((lab) => {
        const ms = missionsInLab(lab);
        const done = ms.filter((m) => this.save.missions[m.id]?.completed).length;
        return ms.length
          ? { label: t('lab.' + lab), status: t('board.done', { done, total: ms.length }), ok: true }
          : { label: t('lab.' + lab), status: t('board.soon'), ok: false };
      }),
    });
  }

  // ---------- interaction ----------

  private bindInput() {
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.state === 'playing') this.pause();
    });
    this.canvas.addEventListener('click', () => {
      this.sfx.unlock();
      if (this.state === 'playing' && !document.pointerLockElement) this.lock();
    });
    addEventListener('keydown', (e) => {
      this.sfx.unlock();
      if (e.code === 'F3') { e.preventDefault(); this.dev = !this.dev; if (!this.dev) this.ui.setDev(null); }
      if (this.state !== 'playing') return;
      if (e.code === 'KeyE' && !e.repeat) this.interact();
      if (e.code === 'Tab') { e.preventDefault(); this.updateObjective(true); }
    });
    addEventListener('keyup', (e) => { if (e.code === 'Tab' && this.state === 'playing') this.updateObjective(false); });
  }

  private findTarget(): Interactable | null {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.raycaster.far = 3.0;
    const hits = this.raycaster.intersectObjects(this.world.root.children, true);
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        const it = this.interactMap.get(o);
        if (it) return it;
        o = o.parent;
      }
      // first solid hit blocks interaction behind it (ignore transparent glass)
      const mat = (hit.object as THREE.Mesh).material as THREE.Material;
      if (!mat || !(mat as THREE.Material).transparent) return null;
    }
    return null;
  }

  private updatePrompt() {
    const it = this.findTarget();
    this.target = it;
    if (!it) { this.ui.setPrompt(null); return; }
    if (it.id.startsWith('door:')) {
      const lab = it.id.slice(5);
      const door = this.world.doors.find((d) => d.lab === lab)!;
      if (door.unlocked) { this.ui.setPrompt(null); this.target = null; return; }
      this.ui.setPrompt({ text: `${t('lab.' + lab)} — ${t('door.soon')}`, dim: true });
      return;
    }
    this.ui.setPrompt({ key: 'E', text: t(it.actionKey) });
  }

  private interact() {
    const it = this.target;
    if (!it) return;
    if (it.id.startsWith('door:')) { this.sfx.denied(); return; }
    this.sfx.ui();
    if (it.id.startsWith('mission:')) { this.openMission(it.id.slice(8)); return; }
    document.exitPointerLock();
    this.state = 'paused';
    this.player.enabled = false;
    const back = () => this.enterGame();
    if (it.id === 'reception') {
      this.view(() => this.ui.showInfo(t('app.title'), [t('reception.welcome', { name: this.save.nickname }), t('objective.goSoc')], back));
    } else this.showProgress(back);
  }

  // ---------- missions ----------

  private openMission(id: string) {
    const def = missionById(id);
    if (!def) return;
    let run = this.runs.get(id);
    if (!run || run.finished) { run = new MissionRun(def); this.runs.set(id, run); }
    this.state = 'mission';
    this.player.enabled = false;
    this.player.clearInput();
    this.ui.setPrompt(null);
    this.ui.showHud(false);
    document.exitPointerLock();
    this.mountMission(run);
  }

  private mountMission(run: MissionRun) {
    this.missionUI?.destroy();
    const ui = new MissionUI(run, {
      onCommand: () => {
        this.save.stats.commands++;
        const ach = evaluateAchievements(this.save);
        ach.forEach((a) => this.ui.toast(t('toast.achievement', { name: t('ach.' + a) }), 'ok'));
      },
      onKey: () => this.sfx.key(),
      onObjective: () => { this.sfx.objective(); this.ui.toast(t('toast.objective'), 'ok', 2200); },
      onFeedback: (ok, key) => { if (!ok) this.sfx.error(); this.ui.toast(t(key), ok ? 'ok' : 'warn', 5200); },
      onHint: () => { this.save.stats.hintsUsed++; this.persist(); },
      onLeave: () => this.closeMission(),
      onComplete: (timeMs, hints) => this.completeMission(run, timeMs, hints),
    });
    this.missionUI = ui;
    this.reopen = null;
    this.ui.mountRaw(ui.el);
  }

  private completeMission(run: MissionRun, timeMs: number, hints: number) {
    const def = run.def;
    const prevRank = rankFor(totalXp(this.save)).id;
    const xp = computeXp(def.baseXp, hints, timeMs, def.parTime);
    const labIds = missionsInLab(def.lab).map((m) => m.id);
    const res = recordCompletion(this.save, def.id, xp, timeMs, hints, labIds);
    this.persist();
    this.sfx.complete();
    const newRank = rankFor(totalXp(this.save)).id;
    res.newAchievements.forEach((a) => this.ui.toast(t('toast.achievement', { name: t('ach.' + a) }), 'ok', 5000));
    if (newRank !== prevRank) this.ui.toast(t('toast.rankUp', { rank: t('rank.' + newRank) }), 'ok', 5000);
    this.refreshWorldInfo();
    this.ui.setXp(this.save);
    this.missionUI?.showDebrief(xp, res.gained, this.save.missions[def.id].bestXp,
      () => this.closeMission(),
      () => { const r = new MissionRun(def); this.runs.set(def.id, r); this.mountMission(r); });
  }

  private closeMission() {
    this.missionUI?.destroy();
    this.missionUI = null;
    this.ui.closeModal();
    this.persist();
    this.enterGame();
  }

  // ---------- loop ----------

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const time = this.clock.elapsedTime;

    if (this.state === 'menu') {
      const a = time * 0.06;
      this.camera.position.set(Math.sin(a) * 3.5, 2.1, 5.5 + Math.cos(a) * 1.2);
      this.camera.lookAt(0, 2.3, -9);
    } else {
      this.player.update(this.state === 'playing' ? dt : 0, this.world.colliders);
      if (this.state === 'playing') this.updatePrompt();
    }
    if (this.state === 'playing' || this.state === 'mission') this.save.stats.playTimeMs += dt * 1000;

    this.camera.updateMatrixWorld();
    const opened = this.world.update(time, dt, this.player.position, this.camera);
    if (opened && this.state === 'playing') this.sfx.door();

    this.renderer.render(this.scene, this.camera);

    if (performance.now() - this.lastSave > 15000 && this.state !== 'menu') this.persist();

    this.fps.frames++; this.fps.acc += dt;
    if (this.fps.acc >= 0.5) { this.fps.value = Math.round(this.fps.frames / this.fps.acc); this.fps.frames = 0; this.fps.acc = 0; }
    if (this.dev) {
      const i = this.renderer.info;
      const p = this.player.position;
      this.ui.setDev(`FPS ${this.fps.value}\ncalls ${i.render.calls}  tris ${i.render.triangles}\npos ${p.x.toFixed(1)}, ${p.z.toFixed(1)}  state ${this.state}`);
    }
  }
}
