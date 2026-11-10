import { describe, expect, it } from 'vitest';
import { missionS2, PHISH } from './soc/s2/mission';
import { missionN2 } from './network/n2/mission';
import { missionK2, C2_IP } from './cloud/k2/mission';
import { missionC2, INITIAL as C2_INITIAL, runC2 } from './coding/c2/mission';
import { missionF2 } from './forensics/f2/mission';
import { missionX2 } from './crypto/x2/mission';

const sh = (s: any) => (l: string) => s.console.run(l).text as string;

describe('new missions', () => {
  it('S2 phishing', () => {
    const s = missionS2.createSession(); const r = sh(s);
    expect(r(`cat reported/${PHISH}`)).toContain('Received-SPF: fail');
    r(`submit email ${PHISH}`); r('submit domain micros0ft-support.example'); r(`quarantine reported/${PHISH}`);
    expect(s.status()).toEqual({ email: true, domain: true, quarantine: true });
  });
  it('S2 spoofed From domain is not the answer', () => {
    const s = missionS2.createSession(); sh(s)('submit domain microsoft.com');
    expect(s.takeFeedback()?.key).toBe('fb.s2.spoofed');
  });
  it('N2 VLANs', () => {
    const s = missionN2.createSession(); const r = sh(s);
    ['en', 'conf t', 'vlan 20', 'name FINANCE', 'vlan 30', 'name GUEST', 'exit', 'int fa0/2', 'switchport access vlan 20', 'int fa0/4', 'switchport access vlan 30', 'end'].forEach(r);
    expect(s.status()).toEqual({ vlans: true, assign: true, save: false });
    r('wr');
    expect(s.status().save).toBe(true);
    expect(r('show vlan brief')).toContain('FINANCE');
  });
  it('K2 respawns if cron is left, solution works', () => {
    const s = missionK2.createSession(); const r = sh(s);
    expect(r('ps aux')).toContain('kworkerd');
    r('sudo kill -9 31337'); r('ps aux');
    expect(r('ps aux')).toContain('kworkerd');
    const pid = r('ps aux').match(/www-data\s+(\d+)\s+98/)![1];
    r('sudo crontab -u www-data -r'); r(`sudo kill ${pid}`); r('sudo rm -r /tmp/.x'); r(`submit ip ${C2_IP}`);
    for (let i = 0; i < 4; i++) r('ps aux');
    expect(s.status()).toEqual({ process: true, cron: true, binary: true, ip: true });
  });
  it('C2 XSS: textContent fix passes, original fails', () => {
    const fixed = `function renderComment(list, comment) {
  const item = document.createElement('li');
  const b = document.createElement('strong');
  b.textContent = comment.author;
  item.appendChild(b);
  item.appendChild(document.createTextNode(': ' + comment.text));
  list.appendChild(item);
}`;
    expect(runC2(C2_INITIAL).slice(1).every((x) => x.pass)).toBe(false);
    expect(runC2(fixed).every((x) => x.pass)).toBe(true);
    const half = C2_INITIAL.replace("'<strong>' + comment.author + '</strong>: ' + comment.text", "'<strong>' + comment.author + '</strong>: '");
    expect(runC2(half)[0].pass).toBe(false);
    const s = missionC2.createSession(); s.code!.test(fixed);
    expect(s.status()).toEqual({ xss: true, works: true });
  });
  it('C2 escape function also accepted', () => {
    const esc = `function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function renderComment(list, comment) {
  const item = document.createElement('li');
  item.innerHTML = '<strong>' + escapeHtml(comment.author) + '</strong>: ' + escapeHtml(comment.text);
  list.appendChild(item);
}`;
    expect(runC2(esc).every((x) => x.pass)).toBe(true);
  });
  it('F2 timeline', () => {
    const s = missionF2.createSession(); const r = sh(s);
    expect(r('grep 22: badge.log')).toContain('k.hamdy');
    r('submit suspect s.adel'); expect(s.takeFeedback()?.key).toBe('fb.f2.wasHome');
    r('submit account s.adel'); r('submit suspect k.hamdy');
    expect(s.status()).toEqual({ account: true, suspect: true });
  });
  it('X2 cracking with and without rules', () => {
    const s = missionX2.createSession(); const r = sh(s);
    expect(r('crack leak/users.sha256 leak/wordlist.txt')).toContain('3/6 cracked');
    const withRules = r('crack leak/users.sha256 leak/wordlist.txt --rules');
    expect(withRules).toContain('Summer2026!');
    expect(withRules).toContain('4/6 cracked');
    r('submit password Summer2026!'); r('submit cracked 4');
    expect(s.status()).toEqual({ password: true, cracked: true });
  });
});
