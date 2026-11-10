import { h, fmtTime, SHIELD_SVG, richText } from './dom';
import { t, getLang } from '../i18n';
import { CONFIG } from '../core/config';
import type { SaveData, Lang, Quality, Settings } from '../progression/save';
import { ACHIEVEMENTS, rankFor, totalXp, RANKS } from '../progression/progress';
import { MISSIONS, missionsInLab } from '../missions/registry';

export interface MenuActions {
  start: () => void;
  settings: () => void;
  progress: () => void;
  controls: () => void;
  credits: () => void;
  setLang: (l: Lang) => void;
}

export class UI {
  readonly root = document.getElementById('ui')!;
  private hud = h('div', { class: 'hud' });
  private crosshair = h('div', { class: 'crosshair' });
  private prompt = h('div', { class: 'prompt' });
  private objective = h('div', { class: 'objective' });
  private xpbox = h('div', { class: 'xpbox' });
  private toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
  private dev = h('div', { class: 'dev' });
  private layer = h('div', { style: 'position:absolute;inset:0;pointer-events:none' });
  private modal: HTMLElement | null = null;

  constructor() {
    this.hud.append(this.crosshair, this.prompt, this.objective, this.xpbox);
    this.root.append(this.layer, this.hud, this.toasts);
    this.showHud(false);
    this.setPrompt(null);
  }

  // ---------- generic ----------

  private mount(el: HTMLElement) {
    this.closeModal();
    this.modal = el;
    el.style.pointerEvents = 'auto';
    this.layer.append(el);
    return el;
  }

  closeModal() { this.modal?.remove(); this.modal = null; }
  hasModal() { return this.modal !== null; }
  mountRaw(el: HTMLElement) { return this.mount(el); }

  private panel(title: string, body: (Node | string)[], onClose: () => void) {
    const scrim = h('div', { class: 'scrim', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, onkeydown: (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } } },
      h('div', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', {}, title), h('button', { class: 'x', onclick: onClose }, t('common.close'))),
        h('div', { class: 'panel-body' }, ...body),
      ),
    );
    this.mount(scrim);
    queueMicrotask(() => (scrim.querySelector('button, input') as HTMLElement | null)?.focus());
    return scrim;
  }

  toast(text: string, kind: 'ok' | 'bad' | 'warn' | '' = '', ms = 3800) {
    const el = h('div', { class: 'toast ' + kind }, text);
    this.toasts.append(el);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
    setTimeout(() => el.remove(), ms);
  }

  // ---------- main menu ----------

  showMenu(save: SaveData, a: MenuActions, notice?: string) {
    const xp = totalXp(save);
    const rank = rankFor(xp);
    const hasPlayer = !!save.nickname;
    const shield = h('span');
    shield.innerHTML = SHIELD_SVG; // static, trusted markup
    const menu = h('div', { class: 'menu' },
      h('div', { class: 'menu-col' },
        h('div', { class: 'brand' }, shield.firstElementChild as Element, h('h1', {}, t('app.title'))),
        h('p', { class: 'tagline' }, t('app.tagline')),
        notice ? h('div', { class: 'notice' }, notice) : null,
        hasPlayer ? h('div', { class: 'badge' }, h('b', {}, save.nickname), h('span', {}, `${t('rank.' + rank.id)} · ${xp} XP`)) : null,
        h('nav', { class: 'menu-list' },
          h('button', { class: 'mbtn primary', onclick: a.start }, hasPlayer ? t('menu.continue') : t('menu.start')),
          hasPlayer ? h('button', { class: 'mbtn', onclick: a.progress }, t('menu.progress')) : null,
          h('button', { class: 'mbtn', onclick: a.settings }, t('menu.settings')),
          h('button', { class: 'mbtn', onclick: a.controls }, t('menu.controls')),
          h('button', { class: 'mbtn', onclick: a.credits }, t('menu.credits')),
          CONFIG.feedbackUrl ? h('button', { class: 'mbtn', onclick: () => openFeedback('menu') }, t('menu.feedback')) : null,
        ),
        h('div', { class: 'lang-switch', role: 'group', 'aria-label': t('settings.language') },
          h('button', { 'aria-pressed': String(getLang() === 'en'), onclick: () => a.setLang('en') }, 'English'),
          h('button', { 'aria-pressed': String(getLang() === 'ar'), onclick: () => a.setLang('ar') }, 'العربية'),
        ),
        h('div', { class: 'muted' }, 'v' + CONFIG.version),
      ),
    );
    this.mount(menu);
  }

  // ---------- nickname ----------

  showNickname(current: string, onDone: (name: string) => void, onBack: () => void) {
    const input = h('input', { class: 'text-input', maxlength: 20, value: current, placeholder: t('nick.placeholder'), 'aria-describedby': 'nick-help' });
    const err = h('div', { class: 'err', role: 'alert' });
    const submit = () => {
      const v = input.value.trim().replace(/\s+/g, ' ');
      if (v.length < 2 || v.length > 20) { err.textContent = t('nick.invalid'); input.focus(); return; }
      onDone(v);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    this.panel(t('nick.title'), [
      h('div', { class: 'field' }, input, h('div', { class: 'muted', id: 'nick-help' }, t('nick.help')), err),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: submit }, t('nick.confirm'))),
    ], onBack);
    queueMicrotask(() => input.focus());
  }

  // ---------- settings ----------

  showSettings(s: Settings, onChange: (s: Settings) => void, onLang: (l: Lang) => void, onClose: () => void) {
    const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { s = { ...s, [k]: v }; onChange(s); };
    const qualities: Quality[] = ['low', 'medium', 'high', 'ultra'];
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': t('settings.graphics') });
    const drawSeg = () => seg.replaceChildren(...qualities.map((q) =>
      h('button', { 'aria-pressed': String(s.quality === q), onclick: () => { set('quality', q); drawSeg(); } }, t('settings.q.' + q))));
    drawSeg();
    const slider = (label: string, k: 'sensitivity' | 'master' | 'sfx' | 'ambience', min: number, max: number, step: number) => {
      const id = 'set-' + k;
      const inp = h('input', { id, type: 'range', min, max, step, value: s[k] });
      inp.addEventListener('input', () => set(k, parseFloat(inp.value)));
      return h('div', { class: 'row' }, h('label', { for: id }, label), inp);
    };
    const check = (label: string, k: 'invertY' | 'headBob' | 'muted') => {
      const id = 'set-' + k;
      const inp = h('input', { id, type: 'checkbox' }) as HTMLInputElement;
      inp.checked = s[k];
      inp.addEventListener('change', () => set(k, inp.checked));
      return h('div', { class: 'row' }, h('label', { for: id }, label), inp);
    };
    this.panel(t('settings.title'), [
      h('div', { class: 'row' }, h('span', {}, t('settings.language')), h('div', { class: 'seg' },
        h('button', { 'aria-pressed': String(getLang() === 'en'), onclick: () => onLang('en') }, 'English'),
        h('button', { 'aria-pressed': String(getLang() === 'ar'), onclick: () => onLang('ar') }, 'العربية'))),
      h('div', { class: 'row' }, h('span', {}, t('settings.graphics')), seg),
      h('div', { class: 'muted' }, t('settings.reloadNote')),
      slider(t('settings.sensitivity'), 'sensitivity', 0.2, 3, 0.05),
      check(t('settings.invertY'), 'invertY'),
      check(t('settings.headBob'), 'headBob'),
      slider(t('settings.master'), 'master', 0, 1, 0.01),
      slider(t('settings.sfx'), 'sfx', 0, 1, 0.01),
      slider(t('settings.ambience'), 'ambience', 0, 1, 0.01),
      check(t('settings.mute'), 'muted'),
    ], onClose);
  }

  // ---------- progress ----------

  showProgress(save: SaveData, onExport: () => void, onImport: (file: File) => void, onClose: () => void) {
    const xp = totalXp(save);
    const rank = rankFor(xp);
    const file = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' }) as HTMLInputElement;
    file.addEventListener('change', () => { if (file.files?.[0]) onImport(file.files[0]); });
    const labs = CONFIG.labs.map((lab) => {
      const ms = missionsInLab(lab);
      if (!ms.length) return h('div', { class: 'item locked' }, h('span', {}, t('lab.' + lab)), h('span', { class: 's-no' }, t('board.soon')));
      return h('div', { class: 'list' },
        h('h3', {}, t('lab.' + lab)),
        ...ms.map((m) => {
          const r = save.missions[m.id];
          return h('div', { class: 'item' },
            h('span', {}, t(`mission.${m.id}.title`)),
            r?.completed
              ? h('span', { class: 's-ok' }, t('progress.best', { xp: r.bestXp, time: r.bestTimeMs !== null ? fmtTime(r.bestTimeMs) : '—', hints: r.fewestHints ?? 0 }))
              : h('span', { class: 's-no' }, t('progress.notStarted')));
        }),
      );
    });
    const stat = (v: string | number, l: string) => h('div', { class: 'stat' }, h('div', { class: 'v' }, String(v)), h('div', { class: 'l' }, l));
    this.panel(t('progress.title'), [
      h('div', { class: 'stat-grid' },
        stat(save.nickname || '—', t('progress.rank') + ': ' + t('rank.' + rank.id)),
        stat(xp, t('progress.xp')),
        stat(`${MISSIONS.filter((m) => save.missions[m.id]?.completed).length}/${MISSIONS.length}`, t('progress.missions')),
      ),
      h('div', {}, h('div', { class: 'bar' }, h('i', { style: `width:${Math.round(rank.progress * 100)}%` })),
        h('div', { class: 'muted' }, rank.next ? t('progress.next', { n: rank.next.xp - xp, rank: t('rank.' + rank.next.id) }) : t('progress.maxRank'))),
      h('h3', {}, t('progress.missions')),
      ...labs,
      h('h3', {}, t('progress.escape')),
      h('div', { class: 'item' }, h('span', {}, t('progress.escape')), save.escape.completed && save.escape.bestTimeMs !== null
        ? h('span', { class: 's-ok' }, t('esc.done.best', { t: fmtTime(save.escape.bestTimeMs) }))
        : h('span', { class: 's-no' }, t('progress.escapeNot'))),
      h('h3', {}, t('progress.achievements')),
      h('div', { class: 'list' }, ...ACHIEVEMENTS.map((a) => {
        const got = save.achievements.includes(a);
        return h('div', { class: 'item' + (got ? '' : ' locked') }, h('span', {}, (got ? '✓ ' : '') + t('ach.' + a)), h('span', { class: 'muted' }, t(`ach.${a}.d`)));
      })),
      h('h3', {}, t('progress.stats')),
      h('div', { class: 'stat-grid' },
        stat(save.stats.commands, t('progress.commands')),
        stat(save.stats.hintsUsed, t('progress.hintsUsed')),
        stat(fmtTime(save.stats.playTimeMs), t('progress.playTime')),
      ),
      h('p', { class: 'muted' }, t('progress.saveNote')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: onExport }, t('progress.export')),
        h('button', { class: 'btn', onclick: () => file.click() }, t('progress.import')),
        file,
      ),
    ], onClose);
  }

  showPicker(lab: string, save: SaveData, onPick: (id: string) => void, onClose: () => void) {
    const ms = missionsInLab(lab as any);
    this.panel(t('picker.title') + ' — ' + t('lab.' + lab), [
      h('div', { class: 'list picker' }, ...ms.map((m) => {
        const r = save.missions[m.id];
        return h('div', { class: 'item' },
          h('div', {}, h('div', {}, t(`mission.${m.id}.title`)), h('div', { class: 'muted' }, r?.completed ? t('progress.best', { xp: r.bestXp, time: r.bestTimeMs !== null ? fmtTime(r.bestTimeMs) : '—', hints: r.fewestHints ?? 0 }) : t('progress.notStarted'))),
          h('button', { class: 'btn' + (r?.completed ? '' : ' primary'), onclick: () => onPick(m.id) }, r?.completed ? t('picker.replay') : t('picker.play')));
      })),
    ], onClose);
  }

  showControls(onClose: () => void) {
    const k = (keys: string[], label: string) => [h('span', {}, ...keys.flatMap((x, i) => [i ? ' ' : '', h('kbd', {}, x)])), h('span', {}, label)];
    this.panel(t('controls.title'), [
      h('div', { class: 'keys' },
        ...k(['W', 'A', 'S', 'D'], t('controls.move')),
        ...k(['Mouse'], t('controls.look')),
        ...k(['Shift'], t('controls.sprint')),
        ...k(['Space'], t('controls.jump')),
        ...k(['E'], t('controls.interact')),
        ...k(['Tab'], t('controls.info')),
        ...k(['Esc'], t('controls.pause')),
      ),
      h('p', { class: 'muted' }, t('controls.terminal')),
    ], onClose);
  }

  showCredits(onClose: () => void) {
    this.panel(t('credits.title'), [h('p', {}, t('credits.body')), h('p', { class: 'muted' }, 'v' + CONFIG.version)], onClose);
  }

  showPause(a: { resume: () => void; settings: () => void; progress: () => void; controls: () => void; menu: () => void }) {
    this.panel(t('pause.title'), [
      h('nav', { class: 'menu-list' },
        h('button', { class: 'mbtn primary', onclick: a.resume }, t('pause.resume')),
        h('button', { class: 'mbtn', onclick: a.progress }, t('menu.progress')),
        h('button', { class: 'mbtn', onclick: a.settings }, t('menu.settings')),
        h('button', { class: 'mbtn', onclick: a.controls }, t('menu.controls')),
        CONFIG.feedbackUrl ? h('button', { class: 'mbtn', onclick: () => openFeedback('pause') }, t('menu.feedback')) : null,
        h('button', { class: 'mbtn', onclick: a.menu }, t('pause.mainMenu')),
      ),
    ], a.resume);
  }

  showInfo(title: string, lines: string[], onClose: () => void, mono?: string) {
    this.panel(title, [...lines.map((l) => h('p', {}, richText(l))), ...(mono ? [h('pre', { class: 'mono-block' }, mono)] : [])], onClose);
  }

  showKeypad(check: (code: string) => boolean, onClose: () => void) {
    let code = '';
    let locked = false;
    const display = h('div', { class: 'kp-display', 'aria-live': 'assertive' }, '····');
    const draw = () => { display.className = 'kp-display'; display.textContent = code ? code.padEnd(4, '·') : '····'; };
    const press = (k: string) => {
      if (locked) return;
      if (k === 'C') { code = ''; draw(); return; }
      if (k === 'E') {
        if (!code) return;
        locked = true;
        if (check(code)) { display.className = 'kp-display ok'; display.textContent = t('esc.keypad.granted'); setTimeout(onClose, 800); }
        else { display.className = 'kp-display bad'; display.textContent = t('esc.keypad.denied'); setTimeout(() => { locked = false; code = ''; draw(); }, 900); }
        return;
      }
      if (code.length < 6) { code += k; draw(); }
    };
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'E'];
    const pad = h('div', { class: 'keypad' }, ...keys.map((k) => h('button', { class: 'kp-key' + (k === 'E' ? ' enter' : ''), onclick: () => press(k) }, k === 'C' ? t('esc.keypad.clear') : k === 'E' ? t('esc.keypad.enter') : k)));
    const scrim = this.panel(t('esc.keypad.title'), [display, pad], onClose);
    scrim.addEventListener('keydown', (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Enter') { e.preventDefault(); press('E'); }
      else if (e.key === 'Backspace') { code = code.slice(0, -1); draw(); }
    });
    queueMicrotask(() => (scrim.querySelector('.kp-key') as HTMLElement)?.focus());
  }

  showEscapeDone(timeMs: number, bestMs: number, onBack: () => void) {
    this.panel(t('esc.done.title'), [
      h('p', {}, t('esc.done.body')),
      h('div', { class: 'stat-grid' },
        h('div', { class: 'stat' }, h('div', { class: 'v' }, fmtTime(timeMs)), h('div', { class: 'l' }, t('esc.done.time', { t: '' }).replace(/[:：]\s*$/, ''))),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, fmtTime(bestMs)), h('div', { class: 'l' }, t('esc.done.best', { t: '' }).replace(/[:：]\s*$/, '')))),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: onBack }, t('esc.done.back'))),
    ], onBack);
  }

  // ---------- HUD ----------

  showHud(on: boolean) { this.hud.style.display = on ? '' : 'none'; }

  setPrompt(p: { key?: string; text: string; dim?: boolean } | null) {
    if (!p) { this.prompt.style.display = 'none'; return; }
    this.prompt.style.display = '';
    this.prompt.className = 'prompt' + (p.dim ? ' dim' : '');
    this.prompt.replaceChildren(...(p.key ? [h('kbd', {}, p.key)] : []), h('span', {}, p.text));
  }

  setObjective(text: string, big = false) {
    this.objective.className = 'objective' + (big ? ' big' : '');
    this.objective.replaceChildren(h('div', { class: 't' }, t('objective.current')), h('div', {}, text));
  }

  setXp(save: SaveData) {
    const xp = totalXp(save);
    const r = rankFor(xp);
    this.xpbox.replaceChildren(
      h('div', { class: 'r' }, h('b', {}, t('rank.' + r.id)), h('span', {}, `${xp} XP`)),
      h('div', { class: 'bar' }, h('i', { style: `width:${Math.round(r.progress * 100)}%` })),
    );
  }

  setDev(text: string | null) {
    if (text === null) { this.dev.remove(); return; }
    if (!this.dev.isConnected) this.root.append(this.dev);
    this.dev.textContent = text;
  }
}

export function openFeedback(where: string) {
  if (!CONFIG.feedbackUrl) return;
  const u = new URL(CONFIG.feedbackUrl);
  if (u.hostname === 'github.com' && u.pathname.endsWith('/issues/new')) {
    u.searchParams.set('title', `[Feedback v${CONFIG.version}] `);
    u.searchParams.set('body', `Version: ${CONFIG.version}\nOpened from: ${where}\nBrowser: ${navigator.userAgent}\n\nWhat happened / what would you improve?\n`);
  }
  window.open(u.toString(), '_blank', 'noopener');
}

export { RANKS };
