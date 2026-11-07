import type { MissionDef, Feedback } from '../../types';
import { Shell, type Command } from '../../../terminals/linux/shell';
import { coreCommands, makeHelp } from '../../../terminals/linux/commands';
import { VirtualFS } from '../../../terminals/linux/vfs';
import { rot13, toHex } from '../../../terminals/linux/crypto';

/** X1 — Decode the intercepted message: hex -> base64 -> ROT13. */

export const FLAG = 'NEXUS{layers_are_not_encryption}';
export const PLAIN = `Package is ready. Meet at gate 4, 02:00. Bring the USB.\nproof: ${FLAG}\n`;
export const ENCODED = toHex(btoa(rot13(PLAIN))).replace(/(.{64})/g, '$1\n') + '\n';

export const missionX1: MissionDef = {
  id: 'x1', lab: 'crypto', order: 1, baseXp: 300, hintCount: 3, parTime: 300,
  createSession() {
    const st = { flag: false, time: false };
    let feedback: Feedback | null = null;
    const fs = new VirtualFS({
      '/home/analyst/intercept.txt': { owner: 'analyst', content: ENCODED, mtime: 'Nov  6 01:58' },
      '/home/analyst/README': { owner: 'analyst', content: `Intercepted from a compromised mail server, 01:57.
The suspects think this is "encrypted". It is not: it is only encoded,
in several layers. Peel them off one at a time.

  submit flag NEXUS{...}     the proof string inside the message
  submit time HH:MM          when they are meeting
` },
    });
    const commands: Record<string, Command> = {
      ...coreCommands,
      help: makeHelp('  submit flag <NEXUS{...}> | submit time <HH:MM>\n'),
      submit: (args) => {
        const [kind, v] = args;
        if (!v || !['flag', 'time'].includes(kind)) return { out: 'usage: submit flag NEXUS{...} | submit time HH:MM\n', code: 2 };
        const good = kind === 'flag' ? v === FLAG : /^0?2:00$/.test(v);
        if (good) { st[kind as 'flag' | 'time'] = true; feedback = { ok: true, key: `fb.x1.${kind}Ok` }; return { out: `[intel] ${kind} confirmed  ✔ accepted\n`, code: 0 }; }
        feedback = { ok: false, key: kind === 'flag' && /^ARKHF\{/.test(v) ? 'fb.x1.stillRot' : `fb.x1.${kind}Wrong` };
        return { out: `[intel] ${kind} rejected\n`, code: 1 };
      },
    };
    const shell = new Shell({ fs, cwd: '/home/analyst', home: '/home/analyst', user: 'analyst', host: 'crypto-lab', state: {} }, commands);
    return {
      console: shell,
      objectives: ['flag', 'time'],
      status: () => ({ ...st }),
      takeFeedback: () => { const f = feedback; feedback = null; return f; },
      motd: 'Crypto lab — isolated analysis VM\nStart with: cat README\n',
    };
  },
};
