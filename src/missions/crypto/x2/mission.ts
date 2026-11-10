import type { MissionDef } from '../../types';
import { terminalMission } from '../../helpers';
import { sha256 } from '../../../terminals/linux/crypto';
import { resolvePath } from '../../../terminals/linux/vfs';

export const USERS: [string, string][] = [['m.ali', 'football'], ['s.omar', 'Qx7!vLp2#rT9'], ['ops.admin', 'Summer2026!'], ['h.kamal', 'letmein123'], ['n.farid', 'correct-horse-battery-staple-41'], ['guest', 'guest']];
export const WORDLIST = ['123456', 'password', 'qwerty', 'football', 'iloveyou', 'admin', 'welcome', 'monkey', 'dragon', 'letmein', 'letmein123', 'guest', 'Summer2025!', 'Winter2025!', 'P@ssw0rd', 'nexus', 'academy', 'shadow', 'master', 'sunshine'];

/** Simple mangling rules like real crackers use: bump years, capitalize, add ! or 1. */
export function mangle(w: string): string[] {
  const out = new Set([w]);
  const y = w.match(/(19|20)\d\d/);
  if (y) for (let d = -2; d <= 2; d++) out.add(w.replace(y[0], String(+y[0] + d)));
  out.add(w[0].toUpperCase() + w.slice(1)); out.add(w + '!'); out.add(w + '1'); out.add(w + '123');
  return [...out];
}

export const missionX2: MissionDef = {
  id: 'x2', lab: 'crypto', order: 2, baseXp: 350, hintCount: 3, parTime: 300,
  createSession() {
    let cracked = 0;
    return terminalMission({
      files: {
        '/home/analyst/leak/users.sha256': USERS.map(([u, p]) => `${u}:${sha256(p)}`).join('\n') + '\n',
        '/home/analyst/leak/wordlist.txt': WORDLIST.join('\n') + '\n',
        '/home/analyst/README': `A password database leaked from a partner portal. The passwords were
stored as plain, unsalted SHA-256 hashes. Find out how bad it is.

  crack <hashfile> <wordlist> [--rules]    dictionary attack (offline)

1. What is the password of the admin account?   submit password <value>
2. How many accounts can be cracked in total?   submit cracked <number>
`,
      },
      user: 'analyst', host: 'crypto-lab', cwd: '/home/analyst', ticket: 'intel',
      helpExtra: '  crack <hashfile> <wordlist> [--rules]\n',
      answers: {
        password: (v) => v === 'Summer2026!' ? { ok: true, key: 'fb.x2.pwOk' } : { ok: false, key: v === 'Summer2025!' ? 'fb.x2.almost' : 'fb.x2.pwWrong' },
        cracked: (v) => +v === 4 ? { ok: true, key: 'fb.x2.countOk' } : { ok: false, key: cracked && +v === cracked && cracked < 4 ? 'fb.x2.useRules' : 'fb.x2.countWrong' },
      },
      extra: () => ({
        crack: (args, _s, ctx) => {
          const files = args.filter((a) => !a.startsWith('--'));
          const rules = args.includes('--rules');
          if (files.length < 2) return { out: 'usage: crack <hashfile> <wordlist> [--rules]\n', code: 2 };
          const hf = ctx.fs.get(resolvePath(ctx.cwd, files[0], ctx.home)), wf = ctx.fs.get(resolvePath(ctx.cwd, files[1], ctx.home));
          if (!hf || !wf) return { out: `crack: ${!hf ? files[0] : files[1]}: No such file\n`, code: 1 };
          const table = new Map<string, string>();
          for (const w of wf.content.split('\n').filter(Boolean)) for (const c of rules ? mangle(w) : [w]) table.set(sha256(c), c);
          const lines = hf.content.split('\n').filter(Boolean).map((l) => l.split(':'));
          const hits = lines.filter(([, h]) => table.has(h));
          cracked = hits.length;
          return { out: `Loaded ${lines.length} hashes (raw-sha256, unsalted)\nCandidates: ${table.size}${rules ? ' (wordlist + rules)' : ''}\n` +
            hits.map(([u, h]) => `${table.get(h)!.padEnd(20)} (${u})`).join('\n') + `\n${hits.length}g 0:00:00:00 DONE — ${hits.length}/${lines.length} cracked\n`, code: 0 };
        },
      }),
      objectives: ['password', 'cracked'],
      motd: 'Crypto lab — isolated analysis VM\nStart with: cat README\n',
    });
  },
};
