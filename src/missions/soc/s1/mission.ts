import type { MissionDef, Feedback } from '../../types';
import { Shell, type Command } from '../../../terminals/linux/shell';
import { coreCommands, makeHelp } from '../../../terminals/linux/commands';
import { VirtualFS } from '../../../terminals/linux/vfs';
import { buildAuthLog, buildSyslog, NOTES_EN, PASSWD, HOST } from './data';
import { checkBlock, checkIp, checkLock, checkUser, initialS1State, s1Status, type S1State } from './validator';

const KNOWN_USERS = PASSWD.split('\n').filter(Boolean).map((l) => l.split(':')[0]);

export const missionS1: MissionDef = {
  id: 's1',
  lab: 'soc',
  order: 1,
  baseXp: 300,
  hintCount: 3,
  parTime: 300,
  createSession() {
    const auth = buildAuthLog();
    const fs = new VirtualFS(
      {
        '/var/log/auth.log': { content: auth, owner: 'syslog', perms: '-rw-r--r--', mtime: 'Nov  6 03:41' },
        '/var/log/syslog': { content: buildSyslog(auth), owner: 'syslog', perms: '-rw-r--r--', mtime: 'Nov  6 03:41' },
        '/var/log/nginx/access.log': { content: '10.0.1.21 - - [06/Nov/2026:01:48:10 +0000] "GET /health HTTP/1.1" 200 2 "-" "curl/8.5.0"\n', owner: 'www-data', mtime: 'Nov  6 01:48' },
        '/etc/passwd': PASSWD,
        '/home/analyst/notes.txt': { content: NOTES_EN, owner: 'analyst', mtime: 'Nov  6 03:38' },
      },
      ['/home/analyst', '/tmp', '/var/backups'],
    );

    const state: S1State = initialS1State();
    let feedback: Feedback | null = null;
    const ufwRules: string[] = [];

    const commands: Record<string, Command> = {
      ...coreCommands,
      help: makeHelp('  id, ufw, usermod, passwd\n  submit ip <address> | submit user <name>   record a finding in the ticket\n'),
      id: (args) => {
        const u = args[0] ?? 'analyst';
        const line = PASSWD.split('\n').find((l) => l.startsWith(u + ':'));
        if (!line) return { out: `id: '${u}': no such user\n`, code: 1 };
        const [, , uid, gid] = line.split(':');
        return { out: `uid=${uid}(${u}) gid=${gid}(${u}) groups=${gid}(${u})${u === 'analyst' ? ',4(adm),27(sudo)' : ''}\n`, code: 0 };
      },
      submit: (args) => {
        const [kind, value] = args;
        if (!kind || !value || !['ip', 'user'].includes(kind)) return { out: 'usage: submit ip <address> | submit user <username>\n', code: 2 };
        const fb = kind === 'ip' ? checkIp(value) : checkUser(value);
        feedback = fb;
        if (fb.ok) {
          if (kind === 'ip') state.foundIp = true; else state.foundUser = true;
          return { out: `[ticket INC-4471] finding recorded: ${kind} = ${value}  ✔ accepted by SOC lead\n`, code: 0 };
        }
        state.wrongAnswers++;
        return { out: `[ticket INC-4471] finding rejected: ${kind} = ${value}\n`, code: 1 };
      },
      ufw: (args, _s, ctx) => {
        if (!ctx.sudo) return { out: 'ERROR: You need to be root to run this script\n', code: 1 };
        if (args[0] === 'status') {
          return { out: 'Status: active\n\nTo                         Action      From\n--                         ------      ----\n22/tcp                     ALLOW       Anywhere\n80,443/tcp                 ALLOW       Anywhere\n' + ufwRules.map((ip) => `Anywhere                   DENY        ${ip}`).join('\n') + (ufwRules.length ? '\n' : ''), code: 0 };
        }
        if (args[0] === 'deny' && args[1] === 'from' && args[2]) {
          const ip = args[2];
          if (!/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(ip)) return { out: `ERROR: Bad source address\n`, code: 1 };
          if (ufwRules.includes(ip)) return { out: 'Skipping adding existing rule\n', code: 0 };
          ufwRules.unshift(ip);
          state.blocked.push(ip);
          feedback = checkBlock(ip);
          return { out: 'Rule inserted\n', code: 0 };
        }
        return { out: 'Usage: ufw deny from <ip> | ufw status\n', code: 1 };
      },
      usermod: (args, _s, ctx) => lockCmd('usermod', args, ctx.sudo, args[0] === '-L'),
      passwd: (args, _s, ctx) => lockCmd('passwd', args, ctx.sudo, args[0] === '-l'),
    };

    function lockCmd(name: string, args: string[], sudo: boolean, isLock: boolean) {
      const user = args[1];
      if (!isLock || !user) return { out: name === 'usermod' ? 'Usage: usermod -L <user>   (lock account)\n' : 'Usage: passwd -l <user>   (lock password)\n', code: 2 };
      if (!sudo) return { out: `${name}: Permission denied.\n${name}: cannot lock /etc/shadow; try again later.\n`, code: 1 };
      if (!KNOWN_USERS.includes(user)) return { out: `${name}: user '${user}' does not exist\n`, code: 6 };
      if (!state.locked.includes(user)) state.locked.push(user);
      feedback = checkLock(user);
      return { out: name === 'passwd' ? 'passwd: password changed.\n' : '', code: 0 };
    }

    const shell = new Shell({ fs, cwd: '/home/analyst', home: '/home/analyst', user: 'analyst', host: HOST, state: state as any }, commands);

    return {
      console: shell,
      objectives: ['ip', 'user', 'block', 'lock'],
      status: () => s1Status(state),
      takeFeedback: () => { const f = feedback; feedback = null; return f; },
      motd: `Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)\n\nLast login: Fri Nov  6 03:39:57 2026 from 10.0.1.50\nType 'help' for available commands. Start with: cat notes.txt\n`,
    };
  },
};
