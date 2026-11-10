export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export type Lang = 'en' | 'ar';

export interface MissionRecord {
  completed: boolean;
  bestXp: number;
  bestTimeMs: number | null;
  fewestHints: number | null;
  attempts: number;
}

export interface Settings {
  quality: Quality;
  sensitivity: number; // 0.2 .. 3
  invertY: boolean;
  headBob: boolean;
  master: number; // 0..1
  sfx: number;
  ambience: number;
  muted: boolean;
}

export interface SaveData {
  version: 1;
  nickname: string;
  lang: Lang;
  missions: Record<string, MissionRecord>;
  achievements: string[];
  stats: { commands: number; hintsUsed: number; playTimeMs: number };
  escape: { completed: boolean; bestTimeMs: number | null; runs: number };
  settings: Settings;
}

export const SAVE_KEY = 'nexus-cyber-academy.save';

export const defaultSettings = (): Settings => ({
  quality: 'medium', sensitivity: 1, invertY: false, headBob: true, master: 0.8, sfx: 0.8, ambience: 0.5, muted: false,
});

export const newSave = (): SaveData => ({
  version: 1, nickname: '', lang: 'en', missions: {}, achievements: [],
  stats: { commands: 0, hintsUsed: 0, playTimeMs: 0 }, escape: { completed: false, bestTimeMs: null, runs: 0 }, settings: defaultSettings(),
});

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Validates unknown data and returns a clean SaveData, or null if it is not a usable save. */
export function validateSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as any;
  if (r.version !== 1) return null;
  const base = newSave();
  const d = defaultSettings();
  const s = r.settings ?? {};
  const missions: Record<string, MissionRecord> = {};
  if (r.missions && typeof r.missions === 'object') {
    for (const [id, m] of Object.entries<any>(r.missions)) {
      if (!/^[a-z0-9_-]{1,20}$/.test(id) || !m || typeof m !== 'object') continue;
      missions[id] = {
        completed: bool(m.completed, false),
        bestXp: num(m.bestXp, 0, 10000, 0),
        bestTimeMs: typeof m.bestTimeMs === 'number' ? num(m.bestTimeMs, 0, 1e9, 0) : null,
        fewestHints: typeof m.fewestHints === 'number' ? num(m.fewestHints, 0, 99, 0) : null,
        attempts: num(m.attempts, 0, 1e6, 0),
      };
    }
  }
  return {
    ...base,
    nickname: typeof r.nickname === 'string' ? r.nickname.slice(0, 20) : '',
    lang: r.lang === 'ar' ? 'ar' : 'en',
    missions,
    achievements: Array.isArray(r.achievements) ? r.achievements.filter((a: unknown) => typeof a === 'string').slice(0, 100) : [],
    stats: {
      commands: num(r.stats?.commands, 0, 1e9, 0),
      hintsUsed: num(r.stats?.hintsUsed, 0, 1e9, 0),
      playTimeMs: num(r.stats?.playTimeMs, 0, 1e12, 0),
    },
    escape: {
      completed: bool(r.escape?.completed, false),
      bestTimeMs: typeof r.escape?.bestTimeMs === 'number' ? num(r.escape.bestTimeMs, 0, 1e9, 0) : null,
      runs: num(r.escape?.runs, 0, 1e6, 0),
    },
    settings: {
      quality: ['low', 'medium', 'high', 'ultra'].includes(s.quality) ? s.quality : d.quality,
      sensitivity: num(s.sensitivity, 0.2, 3, d.sensitivity),
      invertY: bool(s.invertY, d.invertY),
      headBob: bool(s.headBob, d.headBob),
      master: num(s.master, 0, 1, d.master),
      sfx: num(s.sfx, 0, 1, d.sfx),
      ambience: num(s.ambience, 0, 1, d.ambience),
      muted: bool(s.muted, d.muted),
    },
  };
}

export interface LoadResult { data: SaveData; recovered: boolean }

/** Loads the save. If it is corrupted, keeps a backup copy and starts fresh. */
export function loadSave(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): LoadResult {
  let raw: string | null = null;
  try { raw = storage.getItem(SAVE_KEY); } catch { return { data: newSave(), recovered: false }; }
  if (!raw) return { data: newSave(), recovered: false };
  try {
    const v = validateSave(JSON.parse(raw));
    if (v) return { data: v, recovered: false };
  } catch { /* fall through */ }
  try { storage.setItem(SAVE_KEY + '.corrupt-backup', raw); } catch { /* ignore */ }
  return { data: newSave(), recovered: true };
}

export function writeSave(data: SaveData, storage: Pick<Storage, 'setItem'> = localStorage): boolean {
  try { storage.setItem(SAVE_KEY, JSON.stringify(data)); return true; } catch { return false; }
}

export function exportSave(data: SaveData): string {
  return JSON.stringify({ ...data, exportedAt: new Date().toISOString(), game: 'nexus-cyber-academy' }, null, 2);
}

export function importSave(text: string): SaveData | null {
  try { return validateSave(JSON.parse(text)); } catch { return null; }
}
