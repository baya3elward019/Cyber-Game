/**
 * S1 — Brute Force Investigation. All data is fictional.
 * IPs use RFC 5737 documentation ranges (203.0.113.0/24, 198.51.100.0/24) and private 10.0.0.0/8.
 */

export const ATTACKER_IP = '203.0.113.47';
export const DECOY_IP = '198.51.100.23';
export const COMPROMISED_USER = 'backup';
export const ATTACK_ATTEMPTS = 142;
export const HOST = 'srv-web-01';

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ev { t: number; msg: (pid: number) => string; svc?: string }

const fmtTime = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return [h, m, s].map((x) => String(x).padStart(2, '0')).join(':');
};

/** Builds /var/log/auth.log deterministically (same output every run). */
export function buildAuthLog(seed = 1337): string {
  const rnd = mulberry32(seed);
  const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const port = () => ri(32768, 60999);
  const ev: Ev[] = [];
  const at = (h: number, m: number, s: number) => h * 3600 + m * 60 + s;

  // Background: cron sessions every 5 minutes from 01:00 to 03:55
  for (let t = at(1, 0, 1); t < at(3, 56, 0); t += 300) {
    ev.push({ t, svc: 'CRON', msg: () => 'pam_unix(cron:session): session opened for user root(uid=0) by (uid=0)' });
    ev.push({ t: t + 1, svc: 'CRON', msg: () => 'pam_unix(cron:session): session closed for user root' });
  }

  // Normal admin activity from the internal network
  const normal: [number, string, string, string][] = [
    [at(1, 12, 4), 'deploy', '10.0.2.15', 'publickey'],
    [at(1, 47, 33), 'alice', '10.0.1.21', 'password'],
    [at(2, 30, 10), 'deploy', '10.0.2.15', 'publickey'],
    [at(2, 58, 41), 'bob', '10.0.1.34', 'password'],
    [at(3, 33, 2), 'deploy', '10.0.2.15', 'publickey'],
  ];
  for (const [t, user, ip, method] of normal) {
    const p = port();
    ev.push({ t, msg: () => `Accepted ${method} for ${user} from ${ip} port ${p} ssh2${method === 'publickey' ? ': ED25519 SHA256:q3Vt8kXbN0rL2mZ7wYc1Hf5aJpE9sUo4GdTiK6vRx0M' : ''}` });
    ev.push({ t, msg: () => `pam_unix(sshd:session): session opened for user ${user}(uid=${user === 'deploy' ? 1002 : user === 'alice' ? 1000 : 1001}) by (uid=0)` });
    ev.push({ t: t + ri(120, 900), msg: () => `pam_unix(sshd:session): session closed for user ${user}` });
  }
  // A couple of sudo commands by admins
  ev.push({ t: at(1, 49, 2), svc: 'sudo', msg: () => '   alice : TTY=pts/0 ; PWD=/home/alice ; USER=root ; COMMAND=/usr/bin/systemctl restart nginx' });
  ev.push({ t: at(3, 1, 15), svc: 'sudo', msg: () => '     bob : TTY=pts/1 ; PWD=/home/bob ; USER=root ; COMMAND=/usr/bin/apt update' });

  // Noise: an admin mistyping their password
  ev.push({ t: at(1, 47, 20), msg: () => `Failed password for alice from 10.0.1.21 port ${port()} ssh2` });
  ev.push({ t: at(2, 58, 30), msg: () => `Failed password for bob from 10.0.1.34 port ${port()} ssh2` });

  // Decoy: small internet scan (4 attempts, gives up)
  for (let i = 0; i < 4; i++) {
    const t = at(2, 14, 5) + i * ri(2, 4);
    ev.push({ t, msg: () => `Failed password for root from ${DECOY_IP} port ${port()} ssh2` });
  }
  ev.push({ t: at(2, 14, 20), msg: () => `Connection closed by authenticating user root ${DECOY_IP} port ${port()} [preauth]` });

  // The attack: 142 failed attempts over ~6 minutes, then success as "backup"
  const realUsers = ['root', 'backup'];
  const tried = ['root', 'admin', 'test', 'oracle', 'ubuntu', 'backup', 'postgres', 'user', 'ftp', 'git', 'guest', 'support'];
  let t = at(3, 14, 2);
  for (let i = 0; i < ATTACK_ATTEMPTS; i++) {
    const u = tried[i % tried.length];
    const p = port();
    const tt = t;
    if (realUsers.includes(u)) ev.push({ t: tt, msg: () => `Failed password for ${u} from ${ATTACKER_IP} port ${p} ssh2` });
    else {
      ev.push({ t: tt, msg: () => `Invalid user ${u} from ${ATTACKER_IP} port ${p}` });
      ev.push({ t: tt, msg: () => `Failed password for invalid user ${u} from ${ATTACKER_IP} port ${p} ssh2` });
    }
    t += rnd() < 0.7 ? 2 : 3;
  }
  const sp = port();
  ev.push({ t: t + 4, msg: () => `Accepted password for ${COMPROMISED_USER} from ${ATTACKER_IP} port ${sp} ssh2` });
  ev.push({ t: t + 4, msg: () => `pam_unix(sshd:session): session opened for user ${COMPROMISED_USER}(uid=34) by (uid=0)` });

  ev.sort((a, b) => a.t - b.t);
  let pid = 2200;
  return ev
    .map((e) => {
      const svc = e.svc ?? 'sshd';
      const tag = svc === 'sudo' ? 'sudo:' : `${svc}[${svc === 'sshd' ? (pid += ri(1, 3)) : ri(3000, 3999)}]:`;
      return `Nov  6 ${fmtTime(e.t)} ${HOST} ${tag} ${e.msg(pid)}`;
    })
    .join('\n') + '\n';
}

export const PASSWD = `root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin
backup:x:34:34:backup:/var/backups:/bin/bash
syslog:x:104:110::/home/syslog:/usr/sbin/nologin
sshd:x:105:65534::/run/sshd:/usr/sbin/nologin
alice:x:1000:1000:Alice Moreau,,,:/home/alice:/bin/bash
bob:x:1001:1001:Bob Hassan,,,:/home/bob:/bin/bash
deploy:x:1002:1002:CI deploy,,,:/home/deploy:/bin/bash
analyst:x:1003:1003:SOC analyst,,,:/home/analyst:/bin/bash
`;

export const NOTES_EN = `SHIFT NOTE — 03:38
From: Karim (SOC lead)

The SIEM flagged unusual SSH activity on srv-web-01 tonight.
I've given you a shell on the box. Please:

  1. Find the IP address behind the attack and submit it:
       submit ip <address>
  2. Find out whether any account was actually broken into:
       submit user <username>
  3. Contain it: block the IP on the host firewall (ufw)
     and lock the compromised account.

Logs are in /var/log. Our internal ranges are 10.0.0.0/8 — those are us.
Don't block anything you can't justify in the report.
`;

export function buildSyslog(authLog: string): string {
  const m = authLog.match(/Nov  6 (\d\d:\d\d:\d\d) \S+ sshd\[\d+\]: Accepted password for backup/);
  const t = m ? m[1] : '03:20:00';
  return `Nov  6 03:00:01 srv-web-01 systemd[1]: Starting Daily apt download activities...
Nov  6 03:00:04 srv-web-01 systemd[1]: apt-daily.service: Deactivated successfully.
Nov  6 03:10:00 srv-web-01 nginx[911]: 2026/11/06 03:10:00 [notice] 911#911: signal process started
Nov  6 ${t} srv-web-01 systemd-logind[612]: New session 57 of user backup.
Nov  6 ${t} srv-web-01 systemd[1]: Started Session 57 of User backup.
Nov  6 03:22:13 srv-web-01 kernel: [83211.431221] TCP: request_sock_TCP: Possible SYN flooding on port 22. Sending cookies.
`;
}
