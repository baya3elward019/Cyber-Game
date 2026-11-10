import { h, richText, fmtTime } from './dom';
import { t } from '../i18n';
import type { MissionDef, MissionSession, CodeTestResult } from '../missions/types';
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
  codeText: string | null = null;
  codeResults: CodeTestResult[] | null = null;
  constructor(readonly def: MissionDef) { this.session = def.createSession(); }
}

export class MissionUI {
  readonly el: HTMLElement;
  private out!: HTMLElement;
  private input: HTMLInputElement | null = null;
  private ps!: HTMLElement;
  private objList!: HTMLElement;
  private hintBox!: HTMLElement;
  private timerEl!: HTMLElement;
  private histIdx = -1;
  private tickHandle = 0;
  private lastTick = 0;

  constructor(private run: MissionRun, private cb: MissionCallbacks) {
    this.el = h('div', { class: 'mission', role: 'dialog', 'aria-modal': 'true' });
    if (!run.started) this.renderBriefing(); else this.renderWork();
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
            h('button', { class: 'btn primary', onclick: () => { this.run.started = true; this.el.className = 'mission'; this.renderWork(); } }, t('mission.beginBtn')),
            h('button', { class: 'btn', onclick: () => this.cb.onLeave() }, t('common.back')),
          ),
        ),
      ),
    );
    queueMicrotask(() => (this.el.querySelector('.btn.primary') as HTMLElement)?.focus());
  }

  private renderWork() {
    if (this.run.session.code) this.renderCode(); else this.renderTerminal();
  }

  private buildSide(extra: HTMLElement | null = null) {
    const { def } = this.run;
    this.objList = h('div', { class: 'list' });
    this.hintBox = h('div', { class: 'list' });
    this.timerEl = h('div', { class: 'timer' }, fmtTime(this.run.elapsedMs));
    return h('aside', { class: 'side' },
      h('section', {}, h('h2', {}, t(`mission.${def.id}.title`)), h('div', { class: 'row' }, h('span', { class: 'muted' }, t('mission.elapsed')), this.timerEl)),
      h('section', {}, h('div', { class: 'muted' }, t('mission.objectives')), this.objList),
      extra ? h('section', {}, extra) : null,
      h('section', {}, h('div', { class: 'muted' }, t('mission.hints')), this.hintBox),
      h('section', { class: 'spacer' }),
      h('section', {}, h('button', { class: 'btn', onclick: () => this.cb.onLeave() }, t('mission.leave') + '  (Esc)')),
    );
  }

  private startTicking() {
    this.renderObjectives();
    this.renderHints();
    this.lastTick = performance.now();
    this.tickHandle = window.setInterval(() => this.tick(), 250);
  }

  private renderCode() {
    const task = this.run.session.code!;
    if (this.run.codeText === null) this.run.codeText = task.initial;
    const gutter = h('pre', { class: 'gutter', 'aria-hidden': 'true' });
    const ta = h('textarea', { class: 'code', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': task.filename }) as HTMLTextAreaElement;
    ta.value = this.run.codeText;
    const syncGutter = () => { gutter.textContent = ta.value.split('\n').map((_, i) => i + 1).join('\n'); gutter.scrollTop = ta.scrollTop; };
    ta.addEventListener('input', () => { this.run.codeText = ta.value; syncGutter(); });
    ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.cb.onLeave(); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        const a = ta.selectionStart, b = ta.selectionEnd;
        ta.value = ta.value.slice(0, a) + '  ' + ta.value.slice(b);
        ta.selectionStart = ta.selectionEnd = a + 2;
        this.run.codeText = ta.value; syncGutter();
      } else if (e.key.length === 1) this.cb.onKey();
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runTests(); }
    });
    syncGutter();
    const results = h('div', { class: 'list' });
    const drawResults = () => {
      const r = this.run.codeResults;
      if (!r) { results.replaceChildren(h('div', { class: 'muted' }, t('code.notRun'))); return; }
      results.replaceChildren(...r.map((x) => h('div', { class: 'test ' + (x.pass ? 'pass' : 'fail') },
        h('span', { class: 'badge-t' }, x.pass ? 'PASS' : 'FAIL'),
        h('div', {}, h('code', {}, x.name), h('div', { class: 'muted' }, x.detail)))));
    };
    const runTests = () => {
      if (this.run.finished) return;
      const before = this.run.session.status();
      this.run.codeResults = task.test(ta.value);
      this.cb.onCommand();
      drawResults();
      this.afterAction(before);
    };
    const editor = h('div', { class: 'term' },
      h('div', { class: 'term-bar' }, h('i'), h('i'), h('i'), h('span', {}, task.filename)),
      h('div', { class: 'editor' }, gutter, ta),
      h('div', { class: 'term-line code-actions' },
        h('button', { class: 'btn primary', onclick: runTests }, t('code.run') + '  (Ctrl+Enter)'),
        h('button', { class: 'btn', onclick: () => { if (confirm(t('code.confirmReset'))) { ta.value = task.initial; this.run.codeText = ta.value; syncGutter(); } } }, t('code.reset')),
        h('span', { class: 'muted' }, t('code.note')),
      ),
    );
    const resBox = h('div', { class: 'list' }, h('div', { class: 'muted' }, t('code.results')), results);
    this.el.replaceChildren(editor, this.buildSide(resBox));
    drawResults();
    this.startTicking();
    queueMicrotask(() => ta.focus());
  }

  private afterAction(before: Record<string, boolean>) {
    const fb = this.run.session.takeFeedback();
    if (fb) this.cb.onFeedback(fb.ok, fb.key);
    const after = this.run.session.status();
    if (Object.keys(after).some((k) => after[k] && !before[k])) { this.cb.onObjective(); }
    this.renderObjectives();
    if (Object.values(after).every(Boolean)) {
      this.run.finished = true;
      if (this.input) this.input.disabled = true;
      setTimeout(() => this.cb.onComplete(this.run.elapsedMs, this.run.hintsUsed), 900);
    }
  }

  private renderTerminal() {
    const { session } = this.run;
    const con = session.console!;
    this.out = h('div', { class: 'term-out', 'aria-live': 'polite' });
    this.ps = h('span', { class: 'ps' }, con.prompt);
    this.input = h('input', { type: 'text', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'terminal input' });
    this.input.addEventListener('keydown', (e) => this.onKey(e as KeyboardEvent));
    const term = h('div', { class: 'term', onclick: () => { if (!getSelection()?.toString()) this.input?.focus(); } },
      h('div', { class: 'term-bar' }, h('i'), h('i'), h('i'), h('span', {}, con.title)),
      this.out,
      h('div', { class: 'term-line' }, this.ps, this.input),
    );
    this.el.replaceChildren(term, this.buildSide());
    if (!this.run.transcript.length) this.print(session.motd, '');
    else this.run.transcript.forEach((l) => this.appendLine(l.text, l.cls));
    this.startTicking();
    queueMicrotask(() => this.input?.focus());
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
      ? h('button', { class: 'btn', onclick: () => { this.run.hintsUsed++; this.cb.onHint(); this.renderHints(); this.input?.focus(); } },
          def.freeHints ? t('act.esc.warden') : t('mission.hintBtn', { n: this.run.hintsUsed + 1, total: def.hintCount, cost: HINT_COST }))
      : h('div', { class: 'muted' }, t('mission.noHints'));
    this.hintBox.replaceChildren(...shown, btn);
  }

  private onKey(e: KeyboardEvent) {
    const sh = this.run.session.console!;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); this.cb.onLeave(); return; }
    if (e.key === 'Tab') { e.preventDefault(); this.input!.value = sh.complete(this.input!.value); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const hist = this.run.history;
      if (!hist.length) return;
      if (this.histIdx === -1) this.histIdx = hist.length;
      this.histIdx = Math.max(0, Math.min(hist.length, this.histIdx + (e.key === 'ArrowUp' ? -1 : 1)));
      this.input!.value = hist[this.histIdx] ?? '';
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); this.out.replaceChildren(); this.run.transcript = []; return; }
    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      if (getSelection()?.toString()) return;
      e.preventDefault(); this.print(`${sh.prompt} ${this.input!.value}^C`, 'cmd'); this.input!.value = ''; return;
    }
    if (e.key !== 'Enter') { if (e.key.length === 1) this.cb.onKey(); return; }
    e.preventDefault();
    if (this.run.finished) return;
    const line = this.input!.value;
    this.input!.value = '';
    this.histIdx = -1;
    this.print(`${sh.prompt} ${line}`, 'cmd');
    if (!line.trim()) return;
    this.run.history.push(line);
    const before = this.run.session.status();
    const res = sh.run(line);
    this.cb.onCommand();
    if (res.clear) { this.out.replaceChildren(); this.run.transcript = []; }
    else if (res.text) this.print(res.text, /✔/.test(res.text) ? 'ok' : /rejected|% Invalid|Command rejected/.test(res.text) ? 'bad' : '');
    this.ps.textContent = sh.prompt;
    this.afterAction(before);
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
