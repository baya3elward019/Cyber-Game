import { describe, expect, it } from 'vitest';
import { missionS1 } from './mission';
import { ATTACKER_IP, ATTACK_ATTEMPTS, DECOY_IP, buildAuthLog } from './data';
import { checkIp, checkUser } from './validator';

describe('S1 data', () => {
  it('is deterministic', () => expect(buildAuthLog()).toBe(buildAuthLog()));
  it('has the expected number of attack attempts', () => {
    const log = buildAuthLog();
    const n = log.split('\n').filter((l) => l.includes('Failed password') && l.includes(ATTACKER_IP)).length;
    expect(n).toBe(ATTACK_ATTEMPTS);
  });
  it('has exactly one successful login from the attacker, as backup', () => {
    const ok = buildAuthLog().split('\n').filter((l) => l.includes('Accepted') && l.includes(ATTACKER_IP));
    expect(ok).toHaveLength(1);
    expect(ok[0]).toContain('for backup ');
  });
});

describe('S1 validator', () => {
  it('accepts the attacker IP and rejects decoys', () => {
    expect(checkIp(ATTACKER_IP).ok).toBe(true);
    expect(checkIp(DECOY_IP)).toEqual({ ok: false, key: 'fb.s1.decoy' });
    expect(checkIp('10.0.1.21').key).toBe('fb.s1.internal');
    expect(checkIp('hello').key).toBe('fb.s1.notIp');
  });
  it('accepts the compromised user only', () => {
    expect(checkUser('backup').ok).toBe(true);
    expect(checkUser('BACKUP').ok).toBe(true);
    expect(checkUser('root').key).toBe('fb.s1.root');
    expect(checkUser('alice').key).toBe('fb.s1.legit');
  });
});

describe('S1 full playthrough via the shell', () => {
  it('can be solved with real commands', () => {
    const s = missionS1.createSession();
    const sh = s.shell;
    const top = sh.run(`grep "Failed password" /var/log/auth.log | grep -oE "[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+" | sort | uniq -c | sort -nr | head -n 1`).text;
    expect(top.trim()).toBe(`${ATTACK_ATTEMPTS} ${ATTACKER_IP}`);
    const acc = sh.run(`grep Accepted /var/log/auth.log | grep ${ATTACKER_IP}`).text;
    expect(acc).toContain('Accepted password for backup');

    sh.run(`submit ip ${ATTACKER_IP}`);
    sh.run('submit user backup');
    expect(sh.run(`ufw deny from ${ATTACKER_IP}`).text).toContain('root');
    sh.run(`sudo ufw deny from ${ATTACKER_IP}`);
    expect(sh.run('usermod -L backup').text).toContain('Permission denied');
    sh.run('sudo usermod -L backup');
    expect(s.status()).toEqual({ ip: true, user: true, block: true, lock: true });
  });

  it('wrong submissions give feedback and do not complete objectives', () => {
    const s = missionS1.createSession();
    s.shell.run(`submit ip ${DECOY_IP}`);
    expect(s.takeFeedback()?.key).toBe('fb.s1.decoy');
    expect(s.takeFeedback()).toBeNull();
    expect(s.status().ip).toBe(false);
  });
});
