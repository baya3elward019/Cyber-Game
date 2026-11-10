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
import { flipBreaker } from '../escape/logic';
import { SCENARIOS, scenarioById, type EscapeScenario } from '../escape/scenarios';
import { STAGES, TIME_LIMIT_MS } from '../redalert/stages';
import { dailyMission, dateKey, recordDaily, DAILY_XP } from '../daily/daily';
import { fmtTime } from '../ui/dom';
import type { LabId } from '../missions/types';

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
  private esc = { active: false, start: 0, seq: [] as string[], run: null as MissionRun | null, lastObj: 0 };
  private scenario: EscapeScenario = SCENARIOS[0];
  private ra = { active: false, start: 0, stage: 0, run: null as MissionRun | null, lastObj: 0, lastBeep: 0 };
  private robot = { near: false, idx: 0, greeted: false, last: 0 };

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

  private view(fn: () => void) { this.ui.setPrompt(null); this.target = null; this.reopen = fn; fn(); }

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
    this.world.setEscapeScenario(this.scenario, t(`esc.${this.scenario.id}.title`));
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
    if (this.ra.active) { this.ui.setObjective(t('ra.hud', { t: fmtTime(TIME_LIMIT_MS - (performance.now() - this.ra.start)), n: this.ra.stage + 1, task: this.raTask() }), big); return; }
    if (this.esc.active) { this.ui.setObjective(t('esc.objective', { t: fmtTime(performance.now() - this.esc.start) }), big); return; }
    const done = (id: string) => this.save.missions[id]?.completed;
    const next = MISSIONS.find((m) => !done(m.id));
    const text = !MISSIONS.some((m) => done(m.id)) ? t('objective.goSoc')
      : next ? t('objective.next', { mission: t(`mission.${next.id}.title`), lab: t('lab.' + next.lab) })
      : t('objective.allDone');
    this.ui.setObjective(text, big);
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
      }).concat([{ label: t('esc.board.row'), status: this.save.escape.completed && this.save.escape.bestTimeMs !== null ? fmtTime(this.save.escape.bestTimeMs) : t('esc.board.open'), ok: true }]),
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
      const id = it.id.slice(5);
      const door = this.world.doors.find((d) => d.id === id)!;
      if (door.unlocked) { this.ui.setPrompt(null); this.target = null; return; }
      this.ui.setPrompt({ text: id.startsWith('esc') ? t('esc.locked') : `${t('lab.' + id)} — ${t('door.soon')}`, dim: true });
      return;
    }
    if (it.id.startsWith('esc:breaker:')) { this.ui.setPrompt({ key: 'E', text: `${t('act.esc.breaker')} — RACK-${it.id.slice(12)}` }); return; }
    this.ui.setPrompt({ key: 'E', text: t(it.actionKey) });
  }

  private interact() {
    const it = this.target;
    if (!it) return;
    this.ui.setPrompt(null);
    this.target = null;
    this.player.clearInput();
    if (it.id.startsWith('door:')) { this.sfx.denied(); return; }
    this.sfx.ui();
    if (it.id === 'robot') { this.robotSay(); return; }
    if (it.id === 'daily') { this.openDaily(); return; }
    if (it.id === 'ra:start') { if (!this.ra.active) this.showRedAlertIntro(); return; }
    if (it.id.startsWith('lab:') && this.ra.active) {
      const lab = it.id.slice(4);
      if (lab === STAGES[this.ra.stage].lab) { this.openRaStage(); return; }
      this.ui.toast(t('ra.wrongLab', { lab: t('lab.' + STAGES[this.ra.stage].lab) }), 'warn');
      return;
    }
    if (it.id.startsWith('lab:')) { this.openLab(it.id.slice(4) as LabId); return; }
    if (it.id.startsWith('esc:')) { this.escInteract(it.id); return; }
    document.exitPointerLock();
    this.state = 'paused';
    this.player.enabled = false;
    const back = () => this.enterGame();
    if (it.id === 'reception') {
      this.view(() => this.ui.showInfo(t('app.title'), [t('reception.welcome', { name: this.save.nickname }), this.objectiveText()], back));
    } else this.showProgress(back);
  }

  // ---------- escape room ----------

  private startEscape() {
    this.esc = { active: true, start: performance.now(), seq: [], run: null, lastObj: 0 };
    this.world.resetEscape();
    this.world.setDoorUnlocked('esc-a', false);
    this.sfx.denied();
    this.ui.toast(t('esc.intro'), 'warn', 6000);
  }

  private escInteract(id: string) {
    if (id.startsWith('esc:breaker:')) {
      const b = id.slice(12);
      const r = flipBreaker(this.esc.seq, b, this.scenario.breakerOrder);
      if (r.result === 'already') return;
      this.esc.seq = r.seq;
      if (r.result === 'trip') { ['A', 'B', 'C'].forEach((x) => this.world.setBreaker(x, false)); this.sfx.error(); this.ui.toast(t('esc.breaker.trip'), 'bad'); return; }
      this.world.setBreaker(b, true);
      if (r.result === 'done') { this.world.setDoorUnlocked('esc-d', true); this.sfx.complete(); this.ui.toast(t('esc.breaker.done'), 'ok', 4500); }
      else { this.sfx.objective(); this.ui.toast(t('esc.breaker.on', { id: 'RACK-' + b }), 'ok', 1800); }
      return;
    }
    if (id === 'esc:terminal') { this.openEscTerminal(); return; }
    document.exitPointerLock();
    this.state = 'paused';
    this.player.enabled = false;
    const back = () => this.enterGame();
    const info = (title: string, lines: string[], mono?: string) => this.view(() => this.ui.showInfo(title, lines, back, mono));
    const sc = this.scenario;
    switch (id) {
      case 'esc:select':
        return this.view(() => this.ui.showEscapePicker(SCENARIOS.map((x) => ({ id: x.id, title: t(`esc.${x.id}.title`), desc: t(`esc.${x.id}.desc`), best: this.save.escapeTimes[x.id] ?? null, current: x.id === sc.id })),
          (pick) => { this.setScenario(pick); this.ui.toast(t('esc.armed', { name: t(`esc.${pick}.title`) }), 'ok'); back(); }, back));
      case 'esc:note': return info(t('esc.note.title'), [t(sc.keys.note)]);
      case 'esc:poster': return info(t('esc.poster.title'), [], sc.mono.poster);
      case 'esc:board': return info(t('esc.board.title'), [t(sc.keys.board)]);
      case 'esc:label': return info(t('esc.label.title'), [t(sc.keys.label)]);
      case 'esc:plaque': return info(t('esc.plaque.title'), [t(sc.keys.plaque)]);
      case 'esc:crash': return info(t('esc.crash.title'), [], sc.mono.crash);
      case 'esc:keypad':
        return this.view(() => this.ui.showKeypad((code) => {
          const ok = code.trim() === sc.pin;
          if (ok) { this.world.setDoorUnlocked('esc-b', true); this.sfx.objective(); this.ui.toast(t('esc.unlocked'), 'ok'); } else this.sfx.denied();
          return ok;
        }, back));
    }
    if (id.startsWith('esc:warden:')) return info(t('esc.warden.title'), [t(sc.keys.warden + id.slice(11))]);
    back();
  }

  private openEscTerminal() {
    if (!this.esc.run || this.esc.run.finished) { this.esc.run = new MissionRun(this.scenario.terminal); this.esc.run.started = true; }
    this.state = 'mission';
    this.player.enabled = false;
    this.player.clearInput();
    this.ui.showHud(false);
    document.exitPointerLock();
    this.mountMission(this.esc.run);
  }

  private finishEscape() {
    const time = performance.now() - this.esc.start;
    this.esc.active = false;
    const e = this.save.escape;
    e.runs++;
    e.completed = true;
    e.bestTimeMs = e.bestTimeMs === null ? time : Math.min(e.bestTimeMs, time);
    const prev = this.save.escapeTimes[this.scenario.id];
    this.save.escapeTimes[this.scenario.id] = prev ? Math.min(prev, time) : time;
    this.give('escape');
    if (SCENARIOS.every((x) => this.save.escapeTimes[x.id])) this.give('escape_all');
    const best = this.save.escapeTimes[this.scenario.id];
    this.persist();
    this.sfx.complete();
    document.exitPointerLock();
    this.state = 'paused';
    this.player.enabled = false;
    this.view(() => this.ui.showEscapeDone(time, best, () => {
      this.world.resetEscape();
      this.player.place(new THREE.Vector3(-8, 0, 8.3), 0);
      this.updateObjective();
      this.enterGame();
    }));
  }

  private give(a: string) {
    if (this.save.achievements.includes(a)) return;
    this.save.achievements.push(a);
    this.ui.toast(t('toast.achievement', { name: t('ach.' + a) }), 'ok', 5000);
  }

  private setScenario(id: string) {
    this.scenario = scenarioById(id);
    this.esc.run = null;
    this.world.setEscapeScenario(this.scenario, t(`esc.${this.scenario.id}.title`));
  }

  // ---------- NEXA ----------

  private robotLine(): string {
    const name = this.save.nickname || '…';
    if (!this.robot.greeted) { this.robot.greeted = true; return t('robot.first', { name }); }
    const next = MISSIONS.find((m) => !this.save.missions[m.id]?.completed);
    const hour = new Date().getHours();
    const solvedToday = this.save.daily.last === dateKey();
    const lines = [
      hour < 12 ? t('robot.morning', { name }) : hour >= 18 ? t('robot.evening', { name }) : t('robot.next', { name, mission: next ? t(`mission.${next.id}.title`) : '', lab: next ? t('lab.' + next.lab) : '' }),
      next ? t('robot.next', { name, mission: t(`mission.${next.id}.title`), lab: t('lab.' + next.lab) }) : t('robot.allDone', { name }),
      solvedToday ? t('robot.dailyDone', { n: this.save.daily.streak }) : t('robot.daily'),
      t('robot.escape'), t('robot.redAlert'), t('robot.tip1'), t('robot.tip2'), t('robot.joke'),
    ];
    return lines[this.robot.idx++ % lines.length];
  }

  private robotSay() {
    const text = this.robotLine();
    this.ui.say(t('robot.name'), text, 6500);
    this.world.robotTalk(Math.min(4500, 1200 + text.length * 45));
    this.sfx.robot();
    this.robot.last = performance.now();
  }

  private updateRobot() {
    const p = this.player.position, r = this.world.robotPos;
    const d = Math.hypot(p.x - r.x, p.z - r.z);
    if (!this.robot.near && d < 4.2) { this.robot.near = true; if (performance.now() - this.robot.last > 4000) this.robotSay(); }
    else if (this.robot.near && d > 6) this.robot.near = false;
  }

  // ---------- daily challenge ----------

  private openDaily() {
    const today = dateKey();
    if (this.save.daily.last === today) { this.ui.toast(t('daily.already'), 'warn'); return; }
    const run = new MissionRun(dailyMission(today));
    run.started = true;
    this.state = 'mission'; this.player.enabled = false; this.player.clearInput(); this.ui.showHud(false);
    document.exitPointerLock();
    this.mountMission(run);
  }

  private dailyDone() {
    if (!recordDaily(this.save.daily, dateKey())) return;
    this.save.bonusXp += DAILY_XP;
    if (this.save.daily.streak >= 3) this.give('daily_3');
    this.persist(); this.sfx.complete();
    this.ui.toast(t('daily.done', { xp: DAILY_XP, n: this.save.daily.streak }), 'ok', 5000);
    this.ui.setXp(this.save); this.refreshWorldInfo();
  }

  // ---------- RED ALERT ----------

  private showRedAlertIntro() {
    document.exitPointerLock();
    this.state = 'paused'; this.player.enabled = false;
    const back = () => this.enterGame();
    const best = this.save.redAlert.bestTimeMs;
    this.view(() => this.ui.showResult(t('ra.title'), t('ra.brief') + (best !== null ? '\n\n' + t('ra.best', { t: fmtTime(best) }) : ''), t('common.back'), back,
      { label: t('ra.start'), action: () => { this.startRedAlert(); back(); } }));
  }

  private startRedAlert() {
    this.ra = { active: true, start: performance.now(), stage: 0, run: null, lastObj: 0, lastBeep: 0 };
    this.save.redAlert.runs++;
    this.world.setAlarm(true);
    this.sfx.alarm();
  }

  private raTask() { return t('ra.task.' + (this.ra.stage + 1)); }

  private openRaStage() {
    const def = STAGES[this.ra.stage];
    if (!this.ra.run || this.ra.run.def.id !== def.id || this.ra.run.finished) { this.ra.run = new MissionRun(def); this.ra.run.started = true; }
    this.state = 'mission'; this.player.enabled = false; this.player.clearInput(); this.ui.showHud(false);
    document.exitPointerLock();
    this.mountMission(this.ra.run);
  }

  private raStageDone() {
    this.ra.stage++;
    this.ra.run = null;
    if (this.ra.stage < STAGES.length) { this.sfx.objective(); this.ui.toast(t('ra.stageDone', { n: this.ra.stage, task: this.raTask() }), 'ok', 5000); return; }
    const time = performance.now() - this.ra.start;
    this.ra.active = false;
    this.world.setAlarm(false);
    const r = this.save.redAlert;
    r.completed = true; r.bestTimeMs = r.bestTimeMs === null ? time : Math.min(r.bestTimeMs, time);
    this.give('red_alert');
    this.persist(); this.sfx.complete();
    document.exitPointerLock();
    this.state = 'paused'; this.player.enabled = false;
    this.view(() => this.ui.showResult(t('ra.win.title'), t('ra.win.body', { t: fmtTime(time) }) + '\n' + t('ra.best', { t: fmtTime(r.bestTimeMs!) }), t('ra.close'), () => this.enterGame()));
  }

  private updateRedAlert(time: number) {
    if (!this.ra.active) return;
    const left = TIME_LIMIT_MS - (performance.now() - this.ra.start);
    if (left <= 0) {
      this.ra.active = false;
      this.world.setAlarm(false);
      if (this.missionUI) { this.missionUI.destroy(); this.missionUI = null; this.ui.closeModal(); }
      this.persist(); this.sfx.error();
      document.exitPointerLock();
      this.state = 'paused'; this.player.enabled = false;
      this.view(() => this.ui.showResult(t('ra.fail.title'), t('ra.fail.body'), t('ra.close'), () => this.enterGame()));
      return;
    }
    if (time - this.ra.lastBeep > 3) { this.ra.lastBeep = time; this.sfx.alarm(); }
    if (this.state === 'playing' && time - this.ra.lastObj > 0.5) { this.ra.lastObj = time; this.ui.setObjective(t('ra.hud', { t: fmtTime(left), n: this.ra.stage + 1, task: this.raTask() })); }
  }

  private updateEscape(time: number) {
    const p = this.player.position;
    if (!this.esc.active && p.z > 11 && p.x < -6.2 && p.x > -9.8) this.startEscape();
    if (!this.esc.active) return;
    if (p.z > 32.8) { this.finishEscape(); return; }
    if (time - this.esc.lastObj > 0.5) { this.esc.lastObj = time; this.ui.setObjective(t('esc.objective', { t: fmtTime(performance.now() - this.esc.start) })); }
  }

  // ---------- missions ----------

  private objectiveText() {
    const next = MISSIONS.find((m) => !this.save.missions[m.id]?.completed);
    return next ? t('objective.next', { mission: t(`mission.${next.id}.title`), lab: t('lab.' + next.lab) }) : t('objective.allDone');
  }

  private openLab(lab: LabId) {
    const ms = missionsInLab(lab);
    if (ms.length === 1) { this.openMission(ms[0].id); return; }
    document.exitPointerLock();
    this.state = 'paused';
    this.player.enabled = false;
    this.view(() => this.ui.showPicker(lab, this.save, (id) => this.openMission(id), () => this.enterGame()));
  }

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
      onComplete: (timeMs, hints) => {
        if (run.def.id.startsWith('ra')) { this.closeMission(); this.raStageDone(); return; }
        if (run.def.id === 'daily') { this.closeMission(); this.dailyDone(); return; }
        if (run.def.id.startsWith('esc2')) { this.closeMission(); this.world.setDoorUnlocked('esc-c', true); this.sfx.objective(); this.ui.toast(t('esc.unlocked'), 'ok'); return; }
        this.completeMission(run, timeMs, hints);
      },
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
    const res = recordCompletion(this.save, def.id, xp, timeMs, hints, labIds, CONFIG.labs.map((l) => missionsInLab(l).map((m) => m.id)));
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
      if (this.state === 'playing') { this.updatePrompt(); this.updateEscape(time); this.updateRobot(); }
      else if (this.target) { this.target = null; this.ui.setPrompt(null); }
      this.updateRedAlert(time);
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
