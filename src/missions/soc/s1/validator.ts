import type { Feedback } from '../../types';
import { ATTACKER_IP, COMPROMISED_USER, DECOY_IP } from './data';

export interface S1State {
  foundIp: boolean;
  foundUser: boolean;
  blocked: string[];
  locked: string[];
  wrongAnswers: number;
}

export const initialS1State = (): S1State => ({ foundIp: false, foundUser: false, blocked: [], locked: [], wrongAnswers: 0 });

const isIPv4 = (v: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(v) && v.split('.').every((n) => +n <= 255);

export function checkIp(value: string): Feedback {
  const v = value.trim();
  if (!isIPv4(v)) return { ok: false, key: 'fb.s1.notIp' };
  if (v === ATTACKER_IP) return { ok: true, key: 'fb.s1.ipCorrect' };
  if (v === DECOY_IP) return { ok: false, key: 'fb.s1.decoy' };
  if (v.startsWith('10.')) return { ok: false, key: 'fb.s1.internal' };
  return { ok: false, key: 'fb.s1.ipWrong' };
}

export function checkUser(value: string): Feedback {
  const v = value.trim().toLowerCase();
  if (v === COMPROMISED_USER) return { ok: true, key: 'fb.s1.userCorrect' };
  if (v === 'root') return { ok: false, key: 'fb.s1.root' };
  if (['alice', 'bob', 'deploy'].includes(v)) return { ok: false, key: 'fb.s1.legit' };
  return { ok: false, key: 'fb.s1.userWrong' };
}

/** Feedback for a firewall block. Blocking is always allowed, but the UI warns on bad targets. */
export function checkBlock(ip: string): Feedback {
  if (ip === ATTACKER_IP) return { ok: true, key: 'fb.s1.blocked' };
  if (ip.startsWith('10.')) return { ok: false, key: 'fb.s1.blockedInternal' };
  return { ok: false, key: 'fb.s1.blockedOther' };
}

export function checkLock(user: string): Feedback {
  if (user === COMPROMISED_USER) return { ok: true, key: 'fb.s1.locked' };
  return { ok: false, key: 'fb.s1.lockedWrong' };
}

export function s1Status(s: S1State): Record<string, boolean> {
  return {
    ip: s.foundIp,
    user: s.foundUser,
    block: s.blocked.includes(ATTACKER_IP),
    lock: s.locked.includes(COMPROMISED_USER),
  };
}
