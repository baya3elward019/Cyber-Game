import type { MissionDef, Feedback, CodeTestResult } from '../../types';

/** C1 — SQL injection. The player rewrites a login query. Code is analyzed, never executed. */

export const INITIAL = `// auth/login.js — called by POST /api/login
const { hash } = require('./crypto');

async function login(db, username, password) {
  const sql = "SELECT id, role FROM users WHERE username = '" + username +
              "' AND password_hash = '" + hash(password) + "'";
  const rows = await db.query(sql);
  return rows.length === 1 ? rows[0] : null;
}

module.exports = { login };
`;

/** Removes comments and collapses whitespace so formatting does not matter. */
export function normalize(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:"'`])\/\/.*$/gm, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface C1Analysis {
  hasLogin: boolean;
  concatenated: boolean;   // user input glued into SQL text
  filtered: boolean;       // tried to "clean" input with replace/escape
  placeholders: number;    // ? or $1-style placeholders in the SELECT
  boundParams: boolean;    // db.query(sql, [username, hash(password)])
  keepsColumns: boolean;   // still checks username and password_hash
  returnsUser: boolean;
  legacyWorks: boolean;    // original concatenated query (vulnerable, but functional)
}

export function analyze(code: string): C1Analysis {
  const n = normalize(code);
  const sqlStrings = [...n.matchAll(/(["'`])((?:\\.|(?!\1).)*?SELECT(?:\\.|(?!\1).)*?)\1/gi)].map((m) => m[2]);
  // collect the whole SELECT text, including continuation strings joined with +
  const selectText = sqlStrings.join(' ') + ' ' + [...n.matchAll(/(["'`])((?:\\.|(?!\1).)*?(?:password_hash|AND|WHERE)(?:\\.|(?!\1).)*?)\1/gi)].map((m) => m[2]).join(' ');
  const concatenated =
    /["'`]\s*\+\s*(username|password|hash\s*\(\s*password\s*\))/.test(n) ||
    /(username|hash\s*\(\s*password\s*\)|password)\s*\+\s*["'`]/.test(n) ||
    /\$\{\s*(username|password|hash\s*\(\s*password\s*\))[^}]*\}/.test(n) ||
    /\.concat\s*\(/.test(n);
  const placeholders = (selectText.match(/\?|\$[12]\b/g) ?? []).length;
  return {
    hasLogin: /async function login\s*\(\s*db\s*,\s*username\s*,\s*password\s*\)/.test(n),
    concatenated,
    filtered: /username\s*\.\s*replace|escape\w*\s*\(\s*username|password\s*\.\s*replace/.test(n),
    placeholders,
    boundParams: /db\.query\(\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[\w.]+)\s*,\s*\[\s*username\s*,\s*hash\s*\(\s*password\s*\)\s*\]\s*\)/.test(n),
    keepsColumns: /username\s*=\s*(\?|\$1)/i.test(selectText) && /password_hash\s*=\s*(\?|\$2)/i.test(selectText),
    returnsUser: /return\s+rows/.test(n),
    legacyWorks: /db\.query\(\s*sql\s*\)/.test(n) && /username\s*=\s*'/i.test(n) && /password_hash\s*=\s*'/i.test(n),
  };
}

export function runTests(code: string): CodeTestResult[] {
  const a = analyze(code);
  const safe = !a.concatenated && a.boundParams && a.placeholders >= 2;
  const works = a.hasLogin && a.returnsUser && ((a.boundParams && a.keepsColumns) || (!a.boundParams && a.legacyWorks));
  const why = a.concatenated ? (a.filtered ? 'input is still glued into the SQL text — filtering characters is not enough' : 'user input is still concatenated into the SQL string')
    : !a.boundParams ? 'query values are not passed separately as parameters' : '';
  const inj = (name: string): CodeTestResult => ({ name, pass: safe, detail: safe ? 'rejected — treated as a literal username' : `bypassed login (${why})` });
  return [
    { name: 'login("alice", "correct-password") returns alice', pass: works, detail: works ? 'returned { id: 3, role: "staff" }' : !a.hasLogin ? 'login(db, username, password) function is missing or renamed' : 'query no longer matches username and password_hash with the bound values' },
    { name: 'login("alice", "wrong-password") returns null', pass: works, detail: works ? 'returned null' : 'could not run: fix the normal login first' },
    inj(`login("admin' --", "x")`),
    inj(`login("' OR '1'='1", "x")`),
    inj(`login("x' UNION SELECT 1, 'admin' --", "x")`),
  ];
}

export function c1Status(results: CodeTestResult[] | null): Record<string, boolean> {
  if (!results) return { inject: false, works: false };
  return { inject: results.slice(2).every((r) => r.pass), works: results[0].pass && results[1].pass };
}

export const missionC1: MissionDef = {
  id: 'c1', lab: 'coding', order: 1, baseXp: 300, hintCount: 3, parTime: 300,
  createSession() {
    let last: CodeTestResult[] | null = null;
    let feedback: Feedback | null = null;
    return {
      code: {
        filename: 'auth/login.js',
        language: 'javascript',
        initial: INITIAL,
        test(code: string) {
          last = runTests(code);
          const a = analyze(code);
          const st = c1Status(last);
          feedback = st.inject && st.works ? null
            : a.filtered && a.concatenated ? { ok: false, key: 'fb.c1.filter' }
            : st.inject && !st.works ? { ok: false, key: 'fb.c1.broken' }
            : { ok: false, key: 'fb.c1.still' };
          return last;
        },
      },
      objectives: ['inject', 'works'],
      status: () => c1Status(last),
      takeFeedback: () => { const f = feedback; feedback = null; return f; },
      motd: '',
    };
  },
};
