import type { MissionDef } from '../missions/types';
import { terminalMission } from '../missions/helpers';

/** Escape room puzzle rules (pure, testable). */
export const PIN = '3389';
export const DOOR_CODE = 'VAULT-7F3A';
export const BREAKER_ORDER = ['C', 'A', 'B'] as const;
export const CRASH_LOG: [string, string][] = [['RACK-B', '03:12:09'], ['RACK-C', '03:01:52'], ['RACK-A', '03:07:44']];

export const POSTER = `$ nmap -sV 10.0.9.15
Starting Nmap 7.94 ( https://nmap.org )
Nmap scan report for vault-gw (10.0.9.15)
PORT     STATE SERVICE       VERSION
22/tcp   open  ssh           OpenSSH 9.6p1
80/tcp   open  http          nginx 1.24.0
3389/tcp open  ms-wbt-server Microsoft Terminal Services
(ms-wbt-server = Remote Desktop / RDP)`;

export const checkPin = (code: string) => code.trim() === PIN;

export type BreakerResult = 'on' | 'trip' | 'done' | 'already';
/** Applies one breaker flip to the current sequence. */
export function flipBreaker(seq: string[], id: string): { seq: string[]; result: BreakerResult } {
  if (seq.includes(id)) return { seq, result: 'already' };
  const next = [...seq, id];
  if (BREAKER_ORDER[seq.length] !== id) return { seq: [], result: 'trip' };
  return { seq: next, result: next.length === BREAKER_ORDER.length ? 'done' : 'on' };
}

/** Room 2: the vault terminal. The door code is in a hidden, Base64-encoded file. */
export const missionEsc2: MissionDef = {
  id: 'esc2', lab: 'soc', order: 99, baseXp: 0, hintCount: 2, parTime: 0, freeHints: true,
  createSession() {
    let unlocked = false;
    return terminalMission({
      files: {
        '/home/guest/README': 'VAULT TERMINAL v2.3\nThe door code is stored on this machine.\nOpen the door with:  unlock <code>\n',
        '/home/guest/notes.txt': 'the code is NOT in here :)\n',
        '/home/guest/.door_code': btoa(DOOR_CODE) + '\n',
      },
      user: 'guest', host: 'vault', cwd: '/home/guest', ticket: 'vault',
      helpExtra: '  unlock <code>     open the vault door\n',
      answers: {},
      extra: ({ setFeedback }) => ({
        unlock: (args) => {
          if (!args[0]) return { out: 'usage: unlock <code>\n', code: 2 };
          if (args[0] === DOOR_CODE) { unlocked = true; setFeedback({ ok: true, key: 'esc.unlocked' }); return { out: 'ACCESS GRANTED. Vault door unlocked.\n', code: 0 }; }
          if (args[0] === btoa(DOOR_CODE)) return { out: 'ACCESS DENIED. (That looks encoded. Decode it first.)\n', code: 1 };
          return { out: 'ACCESS DENIED.\n', code: 1 };
        },
      }),
      objectives: ['unlock'],
      status: () => ({ unlock: unlocked }),
      motd: 'vault login: guest\nLast login: never\n',
    });
  },
};
