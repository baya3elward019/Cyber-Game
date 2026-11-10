import type { MissionDef } from '../missions/types';
import { terminalMission } from '../missions/helpers';
import { sha256 } from '../terminals/linux/crypto';
import { POSTER, CRASH_LOG, PIN, BREAKER_ORDER, missionEsc2 } from './logic';

/** Three escape scenarios that re-theme the same three physical rooms. In-world props are English; panels use i18n keys. */
export interface EscapeScenario {
  id: 'vault' | 'binary' | 'cipher';
  pin: string;
  breakerOrder: readonly string[];
  terminal: MissionDef;
  keys: { note: string; board: string; label: string; plaque: string; warden: string };
  props: {
    poster: { title: string; lines: string[]; highlight: number };
    board: { title: string; lines: [string, string][] };
    label: string[];
    plaque: string;
    crash: { title: string; lines: string[] }[];
  };
  mono: { poster: string; crash: string };
}

const unlockCmd = (code: string, ok: () => void) => (args: string[]) => {
  if (!args[0]) return { out: 'usage: unlock <code>\n', code: 2 };
  if (args.join(' ') === code) { ok(); return { out: 'ACCESS GRANTED. Vault door unlocked.\n', code: 0 }; }
  return { out: 'ACCESS DENIED.\n', code: 1 };
};

// ---- binary scenario ----
export const BIN_PIN = '5297';
export const BIN_USER = 'svc_backup';
const failures: [string, number][] = [['admin', 12], [BIN_USER, 37], ['root', 9], ['guest', 3], ['j.mostafa', 2]];
function authFailures(): string {
  const lines: string[] = [];
  let i = 0;
  const max = Math.max(...failures.map((f) => f[1]));
  for (let k = 0; k < max; k++) for (const [u, n] of failures) if (k < n) lines.push(`02:${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(i++ % 60).padStart(2, '0')} vault-gw FAILED login user=${u}`);
  return lines.join('\n') + '\n';
}
const binaryTerminal: MissionDef = {
  id: 'esc2b', lab: 'soc', order: 99, baseXp: 0, hintCount: 2, parTime: 0, freeHints: 'act.esc.warden',
  createSession() {
    let unlocked = false;
    return terminalMission({
      files: { '/home/guest/README': 'VAULT TERMINAL v3.0\nThe door opens for the account that failed to log in the most tonight.\n  unlock <username>\n', '/home/guest/auth_failures.log': authFailures() },
      user: 'guest', host: 'vault', cwd: '/home/guest', ticket: 'vault', helpExtra: '  unlock <username>\n', answers: {},
      extra: () => ({ unlock: unlockCmd(BIN_USER, () => { unlocked = true; }) }),
      objectives: ['unlock'], status: () => ({ unlock: unlocked }), motd: 'vault login: guest\n',
    });
  },
};

// ---- cipher scenario ----
export const CIPHER_PIN = '3159';
const KEYS = ['LOTUS-17', 'ORCHID-24', 'ORCHID-42', 'IRIS-42'];
export const CIPHER_KEY = KEYS[2];
const cipherTerminal: MissionDef = {
  id: 'esc2c', lab: 'soc', order: 99, baseXp: 0, hintCount: 2, parTime: 0, freeHints: 'act.esc.warden',
  createSession() {
    let unlocked = false;
    return terminalMission({
      files: {
        '/home/guest/README': 'VAULT TERMINAL v4.1\nFour key files. Only one is genuine: its SHA-256 is in door.sha256.\n  unlock <key>\n',
        '/home/guest/door.sha256': `expected sha256 of the genuine key file:\n${sha256(CIPHER_KEY + '\n')}\n`,
        ...Object.fromEntries(KEYS.map((k, i) => [`/home/guest/key${i + 1}`, k + '\n'])),
      },
      user: 'guest', host: 'vault', cwd: '/home/guest', ticket: 'vault', helpExtra: '  unlock <key>\n', answers: {},
      extra: () => ({ unlock: unlockCmd(CIPHER_KEY, () => { unlocked = true; }) }),
      objectives: ['unlock'], status: () => ({ unlock: unlocked }), motd: 'vault login: guest\n',
    });
  },
};

export const SCENARIOS: EscapeScenario[] = [
  {
    id: 'vault', pin: PIN, breakerOrder: BREAKER_ORDER, terminal: missionEsc2,
    keys: { note: 'esc.note.body', board: 'esc.board.body', label: 'esc.label.body', plaque: 'esc.plaque.body', warden: 'esc.warden.' },
    props: {
      poster: { title: 'NETWORK SCAN — VAULT-GW', lines: ['PORT      STATE  SERVICE', '22/tcp    open   ssh', '80/tcp    open   http', '3389/tcp  open   ms-wbt-server'], highlight: 3 },
      board: { title: 'PATCHING THIS WEEK', lines: [['✔ SSH', '#1d7a3a'], ['✔ Web server (nginx)', '#1d7a3a'], ['✘ Remote Desktop — postponed', '#b3261e']] },
      label: ['READ ME', 'hidden . files', '— the admin'],
      plaque: '“Bring them back in the order they fell.”',
      crash: CRASH_LOG.slice().sort((a, b) => a[0].localeCompare(b[0])).map(([r, tm]) => ({ title: `${r} — POWER LOST`, lines: ['kernel: PSU failure', `time:   ${tm}`, 'status: OFFLINE'] })),
    },
    mono: { poster: POSTER, crash: CRASH_LOG.map(([r, tm]) => `${r}  kernel: PSU failure  power lost at ${tm}`).join('\n') },
  },
  {
    id: 'binary', pin: BIN_PIN, breakerOrder: ['B', 'C', 'A'], terminal: binaryTerminal,
    keys: { note: 'esc.binary.note', board: 'esc.binary.board', label: 'esc.binary.label', plaque: 'esc.binary.plaque', warden: 'esc.binary.warden.' },
    props: {
      poster: { title: 'PIN — MACHINE COPY', lines: ['digit 1:  0101', 'digit 2:  0010', 'digit 3:  1001', 'digit 4:  0111'], highlight: -1 },
      board: { title: 'BINARY CHEAT SHEET', lines: [['8   4   2   1', '#1f4fa0'], ['0101 = 4 + 1 = 5', '#1d7a3a'], ['read each digit left → right', '#555']] },
      label: ['COUNT,', 'DON\'T GUESS', 'sort | uniq -c'],
      plaque: '“Network first, then servers, then storage.”',
      crash: [
        { title: 'RACK-A — OFFLINE', lines: ['role:   STORAGE ARRAY', 'depends on: servers', 'status: OFFLINE'] },
        { title: 'RACK-B — OFFLINE', lines: ['role:   CORE NETWORK', 'depends on: nothing', 'status: OFFLINE'] },
        { title: 'RACK-C — OFFLINE', lines: ['role:   APP SERVERS', 'depends on: network', 'status: OFFLINE'] },
      ],
    },
    mono: { poster: 'digit 1:  0101\ndigit 2:  0010\ndigit 3:  1001\ndigit 4:  0111', crash: 'RACK-A  role: STORAGE ARRAY   depends on: servers\nRACK-B  role: CORE NETWORK    depends on: nothing\nRACK-C  role: APP SERVERS     depends on: network' },
  },
  {
    id: 'cipher', pin: CIPHER_PIN, breakerOrder: ['B', 'A', 'C'], terminal: cipherTerminal,
    keys: { note: 'esc.cipher.note', board: 'esc.cipher.board', label: 'esc.cipher.label', plaque: 'esc.cipher.plaque', warden: 'esc.cipher.warden.' },
    props: {
      poster: { title: 'CAESAR WHEEL', lines: ['A B C D E F G H I J K L M', 'D E F G H I J K L M N O P', '', 'shift = 3'], highlight: -1 },
      board: { title: 'NEW PIN (do not erase!)', lines: [['WKUHH  RQH', '#b3261e'], ['ILYH  QLQH', '#b3261e'], ['— J.C.', '#555']] },
      label: ['TRUST,', 'BUT VERIFY', 'sha256sum'],
      plaque: '“The first to fall is the last to rise.”',
      crash: CRASH_LOG.slice().sort((a, b) => a[0].localeCompare(b[0])).map(([r, tm]) => ({ title: `${r} — POWER LOST`, lines: ['kernel: PSU failure', `time:   ${tm}`, 'status: OFFLINE'] })),
    },
    mono: { poster: 'A B C D E F G H I J K L M N O P Q R S T U V W X Y Z\nD E F G H I J K L M N O P Q R S T U V W X Y Z A B C\n(shift = 3)', crash: CRASH_LOG.map(([r, tm]) => `${r}  kernel: PSU failure  power lost at ${tm}`).join('\n') },
  },
];
export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
