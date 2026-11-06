import { VirtualFS, resolvePath } from './vfs';

export interface CmdResult { out: string; code: number }
export interface ShellContext {
  fs: VirtualFS;
  cwd: string;
  home: string;
  user: string;
  host: string;
  /** Mission-specific mutable state. */
  state: Record<string, any>;
  history: string[];
  sudo: boolean;
}
export type Command = (args: string[], stdin: string | null, ctx: ShellContext) => CmdResult;

export interface ShellOutput { text: string; clear?: boolean }

/** Split a command line into tokens, honoring single and double quotes. */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let has = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") { quote = ch; has = true; }
    else if (/\s/.test(ch)) { if (cur || has) tokens.push(cur); cur = ''; has = false; }
    else { cur += ch; has = true; }
  }
  if (cur || has) tokens.push(cur);
  return tokens;
}

/** Split on pipes that are not inside quotes. */
export function splitPipes(line: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const ch of line) {
    if (quote) { if (ch === quote) quote = null; cur += ch; }
    else if (ch === '"' || ch === "'") { quote = ch; cur += ch; }
    else if (ch === '|') { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim());
}

export class Shell {
  ctx: ShellContext;
  private commands: Record<string, Command>;

  constructor(ctx: Omit<ShellContext, 'history' | 'sudo'>, commands: Record<string, Command>) {
    this.ctx = { ...ctx, history: [], sudo: false };
    this.commands = commands;
  }

  get prompt() {
    const dir = this.ctx.cwd === this.ctx.home ? '~' : this.ctx.cwd.startsWith(this.ctx.home + '/') ? '~' + this.ctx.cwd.slice(this.ctx.home.length) : this.ctx.cwd;
    return `${this.ctx.user}@${this.ctx.host}:${dir}$`;
  }

  commandNames() { return Object.keys(this.commands).sort(); }

  run(line: string): ShellOutput {
    const trimmed = line.trim();
    if (!trimmed) return { text: '' };
    this.ctx.history.push(trimmed);
    if (trimmed === 'clear') return { text: '', clear: true };
    const stages = splitPipes(trimmed);
    if (stages.some((s) => !s)) return { text: 'bash: syntax error near unexpected token `|\'' };
    let stdin: string | null = null;
    let out = '';
    for (const stage of stages) {
      let tokens = tokenize(stage);
      this.ctx.sudo = false;
      if (tokens[0] === 'sudo') { this.ctx.sudo = true; tokens = tokens.slice(1); }
      if (!tokens.length) return { text: 'usage: sudo command' };
      const [name, ...args] = tokens;
      const cmd = this.commands[name];
      if (!cmd) return { text: `${name}: command not found` };
      const res = cmd(args, stdin, this.ctx);
      out = res.out;
      stdin = res.out;
      if (res.code !== 0 && stages.length > 1 && stage !== stages[stages.length - 1] && !out) break;
    }
    return { text: out.replace(/\n$/, '') };
  }

  /** Tab completion: completes command names (first word) or paths. */
  complete(line: string): string {
    const m = line.match(/^(.*?)(\S*)$/);
    if (!m) return line;
    const [, before, word] = m;
    const isFirst = !before.trim() || /\|\s*$/.test(before) || /(^|\|)\s*sudo\s+$/.test(before);
    let candidates: string[];
    if (isFirst) {
      candidates = this.commandNames().filter((c) => c.startsWith(word));
    } else {
      const slash = word.lastIndexOf('/');
      const dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
      const base = slash >= 0 ? word.slice(slash + 1) : word;
      const dir = resolvePath(this.ctx.cwd, dirPart || '.', this.ctx.home);
      if (!this.ctx.fs.isDir(dir)) return line;
      candidates = this.ctx.fs.list(dir).filter(([n]) => n.startsWith(base)).map(([n, d]) => dirPart + n + (d ? '/' : ''));
    }
    if (candidates.length === 0) return line;
    if (candidates.length === 1) return before + candidates[0] + (candidates[0].endsWith('/') ? '' : ' ');
    let prefix = candidates[0];
    for (const c of candidates) while (!c.startsWith(prefix)) prefix = prefix.slice(0, -1);
    return before + prefix;
  }
}
