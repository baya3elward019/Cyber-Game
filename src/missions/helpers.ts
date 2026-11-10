import type { Feedback } from './types';
import { Shell, type Command } from '../terminals/linux/shell';
import { coreCommands, makeHelp } from '../terminals/linux/commands';
import { VirtualFS, type VFile } from '../terminals/linux/vfs';

/** Shared builder for terminal missions with "submit <kind> <value>" answers. */
export function terminalMission(opts: {
  files: Record<string, VFile | string>;
  dirs?: string[];
  user: string; host: string; cwd: string;
  helpExtra: string;
  answers: Record<string, (v: string) => Feedback>;
  extra?: (api: { setFeedback: (f: Feedback) => void; done: Record<string, boolean> }) => Record<string, Command>;
  objectives: string[];
  status?: (done: Record<string, boolean>) => Record<string, boolean>;
  motd: string;
  ticket: string;
}) {
  const fs = new VirtualFS(opts.files, opts.dirs ?? []);
  const done: Record<string, boolean> = {};
  let feedback: Feedback | null = null;
  const setFeedback = (f: Feedback) => { feedback = f; };
  const kinds = Object.keys(opts.answers);
  const commands: Record<string, Command> = {
    ...coreCommands,
    help: makeHelp(opts.helpExtra + `  submit ${kinds.map((k) => `${k} <value>`).join(' | submit ')}\n`),
    submit: (args) => {
      const [kind, ...rest] = args;
      const value = rest.join(' ');
      if (!kind || !value || !opts.answers[kind]) return { out: `usage: submit ${kinds.map((k) => `${k} <value>`).join(' | submit ')}\n`, code: 2 };
      const fb = opts.answers[kind](value);
      feedback = fb;
      if (fb.ok) { done[kind] = true; return { out: `[${opts.ticket}] ${kind} = ${value}  ✔ accepted\n`, code: 0 }; }
      return { out: `[${opts.ticket}] finding rejected: ${kind} = ${value}\n`, code: 1 };
    },
    ...(opts.extra?.({ setFeedback, done }) ?? {}),
  };
  const shell = new Shell({ fs, cwd: opts.cwd, home: opts.cwd, user: opts.user, host: opts.host, state: {} }, commands);
  return {
    console: shell,
    objectives: opts.objectives,
    status: () => (opts.status ? opts.status(done) : Object.fromEntries(opts.objectives.map((o) => [o, !!done[o]]))),
    takeFeedback: () => { const f = feedback; feedback = null; return f; },
    motd: opts.motd,
  };
}
