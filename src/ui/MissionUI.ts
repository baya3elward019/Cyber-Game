import { h, richText, fmtTime } from './dom';
import { t } from '../i18n';
import type { MissionDef, MissionSession } from '../missions/types';
import { HINT_COST, type XpBreakdown } from '../progression/progress';

export interface MissionCallbacks {
  onCommand: () => void;
  onObjective: () => void;
  onFeedback: (ok: boolean, key: string) => void;
  onHint: () => void;
  onKey: () => void;
  onLeave: () => void;
  onComplete: (timeMs: number, hintsUsed: number) => void;
}

/** Holds a running mission so the player can leave the terminal and come back. */
export class MissionRun {
  session: MissionSession;
  hintsUsed = 0;
  elapsedMs = 0;
  started = false;
  finished = false;
  transcript: { cls: string; text: string }[] = [];
  history: string[] = [];
  constructor(readonly def: MissionDef) { this.session = def.createSession(); }
}

export class MissionUI {
  readonly el: HTMLElement;
  private out!: HTMLElement;
  private input!: HTMLInputElement;
  private ps!: HTMLElement;
  private objList!: HTMLElement;
  private hintBox!: HTMLElement;
  private timerEl!: HTMLElement;
  private histIdx = -1;
  private tickHandle = 0;
  private lastTick = 0;

  constructor(private run: MissionRun, private cb: MissionCallbacks) {
    this.el = h('div', { class: 'mission', role: 'dialog', 'aria-modal': 'true' });
    if (!run.started) this.renderBriefing(); else this.renderTerminal();
  }

  private renderBriefing() {
    const id = this.run.def.id;
    this.el.className = 'scrim';
    this.el.replaceChildren(
      h('div', { class: 'panel brief' },
        h('div', { class: 'panel-head' }, h('h2', {}, t(`mission.${id}.title`)), h('span', { class: 'muted' }, t(`lab.${this.run.def.lab}`))),
        h('div', { class: 'panel-body' },
          h('div', {}, h('div', { class: 'muted' }, t('mission.briefing')), richText(t(`mission.${id}.brief`))),
          h('div', { class: 'list' }, ...this.run.session.objectives.map((o) => h('div', { class: 'item' }, richText(t(`mission.${id}.obj.${o}`))))),
          h('p', { class: 'muted' }, t('mission.terminalNote')),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn primary', onclick: () => { this.run.started = true; this.el.className = 'mission'; this.renderTerminal(); } }, t('mission.beginBtn')),
            h('button', { class: 'btn', onclick: () => this.cb.onLeave() }, t('common.back')),
          ),
        ),
      ),
    );
    queueMicrotask(() => (this.el.querySelector('.btn.primary') as HTMLElement)?.focus());
  }

  private renderTerminal() {
    const { def, session } = this.run;
    this.out = h('div', { class: 'term-out', 'aria-live': 'polite' });
    this.ps = h('span', { class: 'ps' }, session.shell.prompt);
    this.input = h('input', { type: 'text', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'terminal input' });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    const term = h('div', { class: 'term', onclick: () => { if (!getSelection()?.toString()) this.input.focus(); } },
      h('div', { class: 'term-bar' }, h('i'), h('i'), h('i'), h('span', {}, `ssh analyst@${session.shell.ctx.host}`)),
      this.out,
      h('div', { class: 'term-line' }, this.ps, this.input),
    );
    this.objList = h('div', { class: 'list' });
    this.hintBox = h('div', { class: 'list' });
    this.timerEl = h('div', { class: 'timer' }, fmtTime(this.run.elapsedMs));
    const side = h('aside', { class: 'side' },
      h('section', {}, h('h2', {}, t(`mission.${def.id}.title`)), h('div', { class: 'row' }, h('span', { class: 'muted' }, t('mission.elapsed')), this.timerEl)),
      h('section', {}, h('div', { class: 'muted' }, t('mission.objectives')), this.objList),
      h('section', {}, h('div', { class: 'muted' }, t('mission.hints')), this.hintBox),
      h('section', { class: 'spacer' }),
      h('section', {}, h('button', { class: 'btn', onclick: () => this.cb.onLeave() }, t('mission.leave') + '  (Esc)')),
    );
    this.el.replaceChildren(term, side);
    if (!this.run.transcript.length) this.print(session.motd, '');
    else this.run.transcript.forEach((l) => this.appendLine(l.text, l.cls));
    this.renderObjectives();
    this.renderHints();
    this.lastTick = performance.now();
    this.tickHandle = window.setInterval(() => this.tick(), 250);
    queueMicrotask(() => this.input.focus());
  }

  private tick() {
    const now = performance.now();
    if (!this.run.finished) this.run.elapsedMs += now - this.lastTick;
    this.lastTick = now;
    this.timerEl.textContent = fmtTime(this.run.elapsedMs);
  }

  private appendLine(text: string, cls: string) {
    const span = h('span', { class: cls }, text + '\n');
    this.out.append(span);
    this.out.scrollTop = this.out.scrollHeight;
  }

  private print(text: string, cls: string) {
    if (!text) return;
    this.run.transcript.push({ text, cls });
    if (this.run.transcript.length > 600) this.run.transcript.splice(0, 100);
    this.appendLine(text, cls);
  }

  private renderObjectives() {
    const st = this.run.session.status();
    this.objList.replaceChildren(...this.run.session.objectives.map((o) =>
      h('div', { class: 'obj' + (st[o] ? ' done' : '') }, h('span', { class: 'box' }, st[o] ? '✓' : ''), richText(t(`mission.${this.run.def.id}.obj.${o}`))),
    ));
  }

  private renderHints() {
    const { def } = this.run;
    const shown = Array.from({ length: this.run.hintsUsed }, (_, i) => h('div', { class: 'hint' }, richText(t(`mission.${def.id}.hint.${i + 1}`))));
    const btn = this.run.hintsUsed < def.hintCount
      ? h('button', { class: 'btn', onclick: () => { this.run.hintsUsed++; this.cb.onHint(); this.renderHints(); this.input.focus(); } },
          t('mission.hintBtn', { n: this.run.hintsUsed + 1, total: def.hintCount, cost: HINT_COST }))
      : h('div', { class: 'muted' }, t('mission.noHints'));
    this.hintBox.replaceChildren(...shown, btn);
  }

  private onKey(e: KeyboardEvent) {
    const sh = this.run.session.shell;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); this.cb.onLeave(); return; }
    if (e.key === 'Tab') { e.preventDefault(); this.input.value = sh.complete(this.input.value); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const hist = this.run.history;
      if (!hist.length) return;
      if (this.histIdx === -1) this.histIdx = hist.length;
      this.histIdx = Math.max(0, Math.min(hist.length, this.histIdx + (e.key === 'ArrowUp' ? -1 : 1)));
      this.input.value = hist[this.histIdx] ?? '';
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); this.out.replaceChildren(); this.run.transcript = []; return; }
    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      if (getSelection()?.toString()) return;
      e.preventDefault(); this.print(`${sh.prompt} ${this.input.value}^C`, 'cmd'); this.input.value = ''; return;
    }
    if (e.key !== 'Enter') { if (e.key.length === 1) this.cb.onKey(); return; }
    e.preventDefault();
    if (this.run.finished) return;
    const line = this.input.value;
    this.input.value = '';
    this.histIdx = -1;
    this.print(`${sh.prompt} ${line}`, 'cmd');
    if (!line.trim()) return;
    this.run.history.push(line);
    const before = this.run.session.status();
    const res = sh.run(line);
    this.cb.onCommand();
    if (res.clear) { this.out.replaceChildren(); this.run.transcript = []; }
    else if (res.text) this.print(res.text, /✔/.test(res.text) ? 'ok' : /rejected/.test(res.text) ? 'bad' : '');
    this.ps.textContent = sh.prompt;
    const fb = this.run.session.takeFeedback();
    if (fb) this.cb.onFeedback(fb.ok, fb.key);
    const after = this.run.session.status();
    if (Object.keys(after).some((k) => after[k] && !before[k])) { this.cb.onObjective(); this.renderObjectives(); }
    if (Object.values(after).every(Boolean)) {
      this.run.finished = true;
      this.input.disabled = true;
      setTimeout(() => this.cb.onComplete(this.run.elapsedMs, this.run.hintsUsed), 900);
    }
  }

  showDebrief(xp: XpBreakdown, gained: number, best: number, onContinue: () => void, onReplay: () => void) {
    clearInterval(this.tickHandle);
    const id = this.run.def.id;
    const lessons: HTMLElement[] = [];
    for (let i = 1; i <= 6; i++) {
      const key = `mission.${id}.debrief.${i}`;
      const txt = t(key);
      if (txt === key) break;
      lessons.push(h('div', { class: 'lesson' }, richText(txt)));
    }
    const row = (label: string, v: string) => [h('span', {}, label), h('span', {}, v)];
    this.el.className = 'scrim';
    this.el.replaceChildren(
      h('div', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', {}, t('debrief.title') + ' — ' + t(`mission.${id}.title`))),
        h('div', { class: 'panel-body' },
          h('h3', {}, t('debrief.lesson')),
          ...lessons,
          h('div', { class: 'xptable' },
            ...row(t('debrief.base'), `${xp.base}`),
            ...row(`${t('debrief.hints')} (${this.run.hintsUsed})`, `−${xp.hintPenalty}`),
            ...row(t('debrief.noHints'), `+${xp.noHintBonus}`),
            ...row(t('debrief.speed'), `+${xp.speedBonus}`),
            h('span', { class: 'tot' }, t('debrief.total')), h('span', { class: 'tot' }, `${xp.total} XP`),
          ),
          h('p', {}, t('debrief.time', { t: fmtTime(this.run.elapsedMs) }) + ' · ' + (gained > 0 ? t('debrief.gained', { n: gained }) : t('debrief.noGain', { n: best }))),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn primary', onclick: onContinue }, t('debrief.continue')),
            h('button', { class: 'btn', onclick: onReplay }, t('debrief.replay')),
          ),
        ),
      ),
    );
    queueMicrotask(() => (this.el.querySelector('.btn.primary') as HTMLElement)?.focus());
  }

  destroy() { clearInterval(this.tickHandle); this.el.remove(); }
}
