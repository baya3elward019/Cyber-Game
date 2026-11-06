export interface VFile {
  content: string;
  owner?: string;
  perms?: string;
  mtime?: string; // display string, e.g. "Nov  6 03:21"
}

/** Minimal in-memory file system. Directories are implied by file paths plus explicit dirs. */
export class VirtualFS {
  private files = new Map<string, VFile>();
  private dirs = new Set<string>(['/']);

  constructor(init: Record<string, VFile | string> = {}, extraDirs: string[] = []) {
    for (const [p, f] of Object.entries(init)) this.write(p, typeof f === 'string' ? { content: f } : f);
    for (const d of extraDirs) this.mkdirp(normalize(d));
  }

  write(path: string, file: VFile) {
    const p = normalize(path);
    this.files.set(p, { owner: 'root', perms: '-rw-r--r--', mtime: 'Nov  6 03:00', ...file });
    this.mkdirp(parent(p));
  }

  remove(path: string): boolean {
    return this.files.delete(normalize(path));
  }

  mkdirp(dir: string) {
    let cur = '';
    for (const part of dir.split('/').filter(Boolean)) {
      cur += '/' + part;
      this.dirs.add(cur);
    }
  }

  isDir(path: string) { return this.dirs.has(normalize(path)); }
  isFile(path: string) { return this.files.has(normalize(path)); }
  get(path: string) { return this.files.get(normalize(path)); }

  /** Entries directly inside a directory: [name, isDir][] sorted by name. */
  list(dir: string): [string, boolean][] {
    const d = normalize(dir);
    const prefix = d === '/' ? '/' : d + '/';
    const out = new Map<string, boolean>();
    for (const sub of this.dirs) {
      if (sub !== d && sub.startsWith(prefix) && !sub.slice(prefix.length).includes('/')) out.set(sub.slice(prefix.length), true);
    }
    for (const f of this.files.keys()) {
      if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/')) out.set(f.slice(prefix.length), false);
    }
    return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }
}

export function normalize(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}

export function parent(path: string): string {
  const p = normalize(path);
  return p.slice(0, p.lastIndexOf('/')) || '/';
}

export function resolvePath(cwd: string, path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return normalize(home + path.slice(1));
  return path.startsWith('/') ? normalize(path) : normalize(cwd + '/' + path);
}
