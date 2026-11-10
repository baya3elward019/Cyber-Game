import type { MissionDef } from '../missions/types';
import { terminalMission } from '../missions/helpers';
import { rot13, toHex, sha256 } from '../terminals/linux/crypto';

/** A small puzzle that changes every day (same for everyone on the same date). */

export const DAILY_XP = 100;

export function dateKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rng(seedStr: string) {
  let h = 2166136261;
  for (const c of seedStr) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}

const WORDS = ['FIREWALL', 'SANDBOX', 'HONEYPOT', 'BOTNET', 'PHISHING', 'ROOTKIT', 'KEYLOGGER', 'ZERODAY', 'PAYLOAD', 'EXPLOIT', 'BACKDOOR', 'SPOOFING'];
export type DailyType = 'decode' | 'topip' | 'integrity';

export interface DailyPuzzle { type: DailyType; answer: string; files: Record<string, string> }

export function makeDaily(key: string): DailyPuzzle {
  const r = rng('nexus-' + key);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const type = (['decode', 'topip', 'integrity'] as DailyType[])[Math.floor(r() * 3)];
  if (type === 'decode') {
    const w = pick(WORDS);
    const chain = pick([['rot13', 'base64'], ['base64', 'hex'], ['rot13', 'hex']]);
    let v = w;
    for (const step of chain) v = step === 'rot13' ? rot13(v) : step === 'base64' ? btoa(v) : toHex(v);
    return { type, answer: w, files: { 'message.txt': v + '\n' } };
  }
  if (type === 'topip') {
    const ips = Array.from({ length: 5 }, () => `203.0.113.${10 + Math.floor(r() * 240)}`);
    const uniq = [...new Set(ips)];
    const counts = uniq.map((_, i) => (i === 0 ? 30 + Math.floor(r() * 20) : 3 + Math.floor(r() * 20)));
    const lines: string[] = [];
    uniq.forEach((ip, i) => { for (let k = 0; k < counts[i]; k++) lines.push(ip); });
    for (let i = lines.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [lines[i], lines[j]] = [lines[j], lines[i]]; }
    const log = lines.map((ip, i) => `Nov 10 0${Math.floor(i / 60) % 10}:${String(i % 60).padStart(2, '0')}:1${i % 10} gw sshd: Failed password for root from ${ip} port ${40000 + i}`).join('\n') + '\n';
    return { type, answer: uniq[0], files: { 'auth.log': log } };
  }
  const names = ['report.pdf', 'photo.jpg', 'notes.txt', 'budget.xlsx'];
  const bad = Math.floor(r() * names.length);
  const files: Record<string, string> = {};
  const sums: string[] = [];
  names.forEach((n, i) => {
    const orig = `${n} original content #${Math.floor(r() * 9999)}\n`;
    sums.push(`${sha256(orig)}  ${n}`);
    files[n] = i === bad ? orig.replace('original', 'modified') : orig;
  });
  files['SHA256SUMS'] = sums.join('\n') + '\n';
  return { type, answer: names[bad], files };
}

export function dailyMission(key: string): MissionDef {
  const p = makeDaily(key);
  return {
    id: 'daily', lab: 'soc', order: 0, baseXp: 0, hintCount: 1, parTime: 0, freeHints: 'daily.hintBtn',
    createSession() {
      const files: Record<string, string> = { '/home/trainee/TODAY.txt': `Daily challenge — ${key}\n` + {
        decode: 'message.txt was encoded twice (Base64, hex or ROT13). Decode it.\n  submit answer <WORD>\n',
        topip: 'Which IP address made the most failed logins in auth.log?\n  submit answer <ip>\n',
        integrity: 'One of these files does not match SHA256SUMS. Which one?\n  submit answer <file>\n',
      }[p.type] };
      for (const [f, c] of Object.entries(p.files)) files[`/home/trainee/${f}`] = c;
      return terminalMission({
        files, user: 'trainee', host: 'daily', cwd: '/home/trainee', ticket: 'daily', helpExtra: '',
        answers: { answer: (v) => v.trim().toUpperCase() === p.answer.toUpperCase() ? { ok: true, key: 'daily.ok' } : { ok: false, key: 'daily.wrong' } },
        objectives: ['answer'], motd: `Daily challenge ${key}. Start with: cat TODAY.txt\n`,
      });
    },
  };
}

/** Updates the streak when a daily is solved on `today`. Returns true if this is the first solve today. */
export function recordDaily(d: { last: string; streak: number; total: number }, today: string): boolean {
  if (d.last === today) return false;
  const y = new Date(today + 'T12:00:00'); y.setDate(y.getDate() - 1);
  d.streak = d.last === dateKey(y) ? d.streak + 1 : 1;
  d.last = today; d.total++;
  return true;
}
