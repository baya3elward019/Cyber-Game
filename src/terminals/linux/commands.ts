import type { Command, CmdResult, ShellContext } from './shell';
import { resolvePath } from './vfs';
import { sha256, toHex, fromHex, expandSet } from './crypto';

const ok = (out: string): CmdResult => ({ out, code: 0 });
const fail = (out: string, code = 1): CmdResult => ({ out, code });

/** Split args into flag characters and positional args. Supports "-nr", "-n 5", "-n5". */
function parseFlags(args: string[], withValue: string[] = []) {
  const flags = new Set<string>();
  const values: Record<string, string> = {};
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) { flags.add(a); continue; }
    if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      for (let j = 1; j < a.length; j++) {
        const f = a[j];
        if (withValue.includes(f)) {
          const rest = a.slice(j + 1);
          values[f] = rest || args[++i] || '';
          break;
        }
        flags.add(f);
      }
    } else if (/^-\d+$/.test(a) && withValue.includes('n')) {
      values['n'] = a.slice(1);
    } else pos.push(a);
  }
  return { flags, values, pos };
}

/** Read named files, or stdin when no files are given. */
function readInputs(cmd: string, files: string[], stdin: string | null, ctx: ShellContext): { text: string; err: string } {
  if (!files.length) return { text: stdin ?? '', err: '' };
  let text = '';
  let err = '';
  for (const f of files) {
    const p = resolvePath(ctx.cwd, f, ctx.home);
    if (ctx.fs.isDir(p)) { err += `${cmd}: ${f}: Is a directory\n`; continue; }
    const file = ctx.fs.get(p);
    if (!file) { err += `${cmd}: ${f}: No such file or directory\n`; continue; }
    if (file.perms?.[7] !== 'r' && !ctx.sudo && file.owner !== ctx.user) { err += `${cmd}: ${f}: Permission denied\n`; continue; }
    text += file.content.endsWith('\n') ? file.content : file.content + '\n';
  }
  return { text, err };
}

const lines = (t: string) => t.replace(/\n$/, '').split('\n').filter((_x, _i, a) => !(a.length === 1 && a[0] === ''));
const join = (l: string[]) => (l.length ? l.join('\n') + '\n' : '');

/** Help text = core commands + mission-specific lines. */
export function makeHelp(extra: string): Command {
  return () => ok(
    'Available commands:\n' +
    '  ls, cd, pwd, cat, head, tail, grep, wc, sort, uniq, cut, awk, echo,\n' +
    '  whoami, hostname, date, history, clear, base64, xxd, tr, sha256sum, file\n' +
    extra +
    'Pipes work: cmd1 | cmd2.  Use Tab to complete, Up/Down for history.\n');
}

export const coreCommands: Record<string, Command> = {
  help: () => ok(
    'Available commands:\n' +
    '  ls, cd, pwd, cat, head, tail, grep, wc, sort, uniq, cut, awk, echo,\n' +
    '  whoami, hostname, date, history, clear, base64, xxd, tr, sha256sum, file\n' +
    'Pipes work: cmd1 | cmd2.  Use Tab to complete, Up/Down for history.\n'),

  pwd: (_a, _s, ctx) => ok(ctx.cwd + '\n'),
  whoami: (_a, _s, ctx) => ok((ctx.sudo ? 'root' : ctx.user) + '\n'),
  hostname: (_a, _s, ctx) => ok(ctx.host + '\n'),
  date: () => ok('Fri Nov  6 03:41:12 UTC 2026\n'),
  echo: (args) => ok(args.join(' ') + '\n'),
  history: (_a, _s, ctx) => ok(join(ctx.history.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`))),

  cd: (args, _s, ctx) => {
    const target = resolvePath(ctx.cwd, args[0] ?? '~', ctx.home);
    if (ctx.fs.isFile(target)) return fail(`bash: cd: ${args[0]}: Not a directory\n`);
    if (!ctx.fs.isDir(target)) return fail(`bash: cd: ${args[0]}: No such file or directory\n`);
    ctx.cwd = target;
    return ok('');
  },

  ls: (args, _s, ctx) => {
    const { flags, pos } = parseFlags(args);
    const targets = pos.length ? pos : ['.'];
    let out = '';
    for (const t of targets) {
      const p = resolvePath(ctx.cwd, t, ctx.home);
      if (ctx.fs.isFile(p)) { out += fmtEntry(t, ctx, p, flags.has('l')) + '\n'; continue; }
      if (!ctx.fs.isDir(p)) { out += `ls: cannot access '${t}': No such file or directory\n`; continue; }
      let entries = ctx.fs.list(p);
      if (!flags.has('a')) entries = entries.filter(([n]) => !n.startsWith('.'));
      if (targets.length > 1) out += `${t}:\n`;
      if (flags.has('l')) {
        out += `total ${entries.length * 4}\n`;
        out += entries.map(([n, d]) => (d ? `drwxr-xr-x 2 root root     4096 Nov  6 03:00 ${n}` : fmtEntry(n, ctx, p + '/' + n, true))).join('\n') + (entries.length ? '\n' : '');
      } else out += entries.map(([n, d]) => (d ? n + '/' : n)).join('  ') + (entries.length ? '\n' : '');
    }
    return ok(out);
  },

  cat: (args, stdin, ctx) => {
    const { text, err } = readInputs('cat', args.filter((a) => !a.startsWith('-')), stdin, ctx);
    return { out: text + err, code: err ? 1 : 0 };
  },

  head: (args, stdin, ctx) => {
    const { values, pos } = parseFlags(args, ['n']);
    const n = parseInt(values.n ?? '10', 10);
    const { text, err } = readInputs('head', pos, stdin, ctx);
    return { out: join(lines(text).slice(0, n)) + err, code: err ? 1 : 0 };
  },

  tail: (args, stdin, ctx) => {
    const { values, pos } = parseFlags(args, ['n']);
    const n = parseInt(values.n ?? '10', 10);
    const { text, err } = readInputs('tail', pos, stdin, ctx);
    const l = lines(text);
    return { out: join(l.slice(Math.max(0, l.length - n))) + err, code: err ? 1 : 0 };
  },

  grep: (args, stdin, ctx) => {
    const { flags, pos } = parseFlags(args);
    if (!pos.length) return fail('Usage: grep [OPTION]... PATTERNS [FILE]...\n', 2);
    const [pattern, ...files] = pos;
    let src = flags.has('E') || flags.has('F') ? pattern : pattern.replace(/[+?(){}|]/g, '\\$&').replace(/\\\\([+?(){}|])/g, '$1');
    if (flags.has('F')) src = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let re: RegExp;
    try { re = new RegExp(src, flags.has('i') ? 'gi' : 'g'); } catch { return fail('grep: Invalid regular expression\n', 2); }
    const { text, err } = readInputs('grep', files, stdin, ctx);
    const out: string[] = [];
    let count = 0;
    lines(text).forEach((line, i) => {
      re.lastIndex = 0;
      const matched = re.test(line);
      if (matched === flags.has('v')) return;
      count++;
      if (flags.has('o') && !flags.has('v')) {
        re.lastIndex = 0;
        for (const m of line.matchAll(re)) if (m[0]) out.push(m[0]);
      } else out.push(flags.has('n') ? `${i + 1}:${line}` : line);
    });
    if (flags.has('c')) return ok(count + '\n' + err);
    return { out: join(out) + err, code: count ? 0 : 1 };
  },

  wc: (args, stdin, ctx) => {
    const { flags, pos } = parseFlags(args);
    const { text, err } = readInputs('wc', pos, stdin, ctx);
    const l = text ? text.split('\n').length - 1 : 0;
    const w = text.split(/\s+/).filter(Boolean).length;
    const suffix = pos.length === 1 ? ' ' + pos[0] : '';
    if (flags.has('l')) return ok(`${l}${suffix}\n` + err);
    if (flags.has('w')) return ok(`${w}${suffix}\n` + err);
    return ok(`${String(l).padStart(7)} ${String(w).padStart(7)} ${String(text.length).padStart(7)}${suffix}\n` + err);
  },

  sort: (args, stdin, ctx) => {
    const { flags, pos } = parseFlags(args);
    const { text, err } = readInputs('sort', pos, stdin, ctx);
    let l = lines(text);
    if (flags.has('n')) l.sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0) || a.localeCompare(b));
    else l.sort();
    if (flags.has('r')) l.reverse();
    if (flags.has('u')) l = [...new Set(l)];
    return ok(join(l) + err);
  },

  uniq: (args, stdin, ctx) => {
    const { flags, pos } = parseFlags(args);
    const { text, err } = readInputs('uniq', pos, stdin, ctx);
    const out: string[] = [];
    let prev: string | null = null;
    let n = 0;
    const flush = () => { if (prev !== null) out.push(flags.has('c') ? `${String(n).padStart(7)} ${prev}` : prev); };
    for (const line of lines(text)) {
      if (line === prev) n++;
      else { flush(); prev = line; n = 1; }
    }
    flush();
    return ok(join(out) + err);
  },

  cut: (args, stdin, ctx) => {
    const { values, pos } = parseFlags(args, ['d', 'f']);
    if (!values.f) return fail('cut: you must specify a list of bytes, characters, or fields\n');
    const d = values.d ?? '\t';
    const fields = values.f.split(',').map((x) => parseInt(x, 10) - 1);
    const { text, err } = readInputs('cut', pos, stdin, ctx);
    return ok(join(lines(text).map((l) => { const p = l.split(d); return fields.map((i) => p[i] ?? '').join(d); })) + err);
  },

  awk: (args, stdin, ctx) => {
    const { values, pos } = parseFlags(args, ['F']);
    const prog = pos[0];
    const m = prog?.match(/^\s*\{\s*print\s+(.*?)\s*;?\s*\}\s*$/);
    if (!m) return fail("awk: this terminal supports programs of the form '{print $N}' or '{print $1, $3}'\n", 2);
    const exprs = m[1].split(',').map((e) => e.trim());
    const { text, err } = readInputs('awk', pos.slice(1), stdin, ctx);
    const out = lines(text).map((line) => {
      const f = values.F ? line.split(values.F) : line.trim().split(/\s+/);
      return exprs.map((e) => {
        if (e === '$0') return line;
        if (e === '$NF') return f[f.length - 1] ?? '';
        const n = e.match(/^\$(\d+)$/);
        if (n) return f[parseInt(n[1], 10) - 1] ?? '';
        const s = e.match(/^"(.*)"$/);
        return s ? s[1] : '';
      }).join(' ');
    });
    return ok(join(out) + err);
  },
  base64: (args, stdin, ctx) => {
    const { flags, pos } = parseFlags(args);
    const { text, err } = readInputs('base64', pos, stdin, ctx);
    if (flags.has('d')) {
      try { return ok(atob(text.replace(/\s+/g, '')) + err); } catch { return fail('base64: invalid input\n'); }
    }
    try { return ok(btoa(text).replace(/(.{76})/g, '$1\n') + '\n' + err); } catch { return fail('base64: input contains non-ASCII characters\n'); }
  },

  xxd: (args, stdin, ctx) => {
    const { flags, pos } = parseFlags(args);
    const { text, err } = readInputs('xxd', pos, stdin, ctx);
    if (flags.has('r') && flags.has('p')) return ok(fromHex(text) + err);
    if (flags.has('r')) return fail('xxd: this terminal supports -r together with -p (plain hex)\n');
    if (flags.has('p')) return ok(toHex(text).replace(/(.{60})/g, '$1\n') + '\n' + err);
    const rows: string[] = [];
    for (let i = 0; i < text.length; i += 16) {
      const chunk = text.slice(i, i + 16);
      const hex = toHex(chunk).replace(/(.{4})/g, '$1 ').padEnd(40);
      rows.push(`${i.toString(16).padStart(8, '0')}: ${hex} ${chunk.replace(/[^\x20-\x7e]/g, '.')}`);
    }
    return ok(join(rows) + err);
  },

  tr: (args, stdin) => {
    const { flags, pos } = parseFlags(args);
    const input = stdin ?? '';
    if (flags.has('d')) { const del = new Set(expandSet(pos[0] ?? '')); return ok([...input].filter((c) => !del.has(c)).join('')); }
    if (pos.length < 2) return fail("tr: missing operand\nUsage: tr 'SET1' 'SET2'   or   tr -d 'SET'\n");
    const a = expandSet(pos[0]), b = expandSet(pos[1]);
    const map = new Map<string, string>();
    a.forEach((c, i) => map.set(c, b[Math.min(i, b.length - 1)]));
    return ok([...input].map((c) => map.get(c) ?? c).join(''));
  },

  sha256sum: (args, stdin, ctx) => {
    const { flags, pos } = parseFlags(args);
    if (flags.has('c')) {
      const { text, err } = readInputs('sha256sum', pos, stdin, ctx);
      let out = ''; let failed = 0;
      for (const line of lines(text)) {
        const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
        if (!m) continue;
        const f = ctx.fs.get(resolvePath(ctx.cwd, m[2], ctx.home));
        if (!f) { out += `${m[2]}: FAILED open or read\n`; failed++; continue; }
        const good = sha256(f.content) === m[1];
        if (!good) failed++;
        out += `${m[2]}: ${good ? 'OK' : 'FAILED'}\n`;
      }
      if (failed) out += `sha256sum: WARNING: ${failed} computed checksum${failed > 1 ? 's' : ''} did NOT match\n`;
      return { out: out + err, code: failed ? 1 : 0 };
    }
    if (!pos.length) return ok(`${sha256(stdin ?? '')}  -\n`);
    let out = '';
    for (const f of pos) {
      const p = resolvePath(ctx.cwd, f, ctx.home);
      const file = ctx.fs.get(p);
      if (ctx.fs.isDir(p)) out += `sha256sum: ${f}: Is a directory\n`;
      else if (!file) out += `sha256sum: ${f}: No such file or directory\n`;
      else out += `${sha256(file.content)}  ${f}\n`;
    }
    return ok(out);
  },

  file: (args, _s, ctx) => {
    let out = '';
    for (const f of args) {
      const p = resolvePath(ctx.cwd, f, ctx.home);
      const file = ctx.fs.get(p);
      if (ctx.fs.isDir(p)) { out += `${f}: directory\n`; continue; }
      if (!file) { out += `${f}: cannot open \`${f}' (No such file or directory)\n`; continue; }
      const c = file.content;
      const type = /\.pdf$/.test(f) ? 'PDF document, version 1.7' : /\.jpe?g$/.test(f) ? 'JPEG image data, JFIF standard 1.01' : /^[0-9a-fA-F\s]+$/.test(c) ? 'ASCII text (hex digits only)' : /^[A-Za-z0-9+/=\s]+$/.test(c) ? 'ASCII text' : 'ASCII text';
      out += `${f}: ${type}\n`;
    }
    return ok(out);
  },
};

function fmtEntry(name: string, ctx: ShellContext, path: string, long: boolean) {
  if (!long) return name;
  const f = ctx.fs.get(path)!;
  const owner = (f.owner ?? 'root').padEnd(8);
  return `${f.perms ?? '-rw-r--r--'} 1 ${owner} ${owner} ${String(f.content.length).padStart(8)} ${f.mtime ?? 'Nov  6 03:00'} ${name}`;
}
