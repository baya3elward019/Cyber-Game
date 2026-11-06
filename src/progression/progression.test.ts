import { describe, expect, it } from 'vitest';
import { exportSave, importSave, loadSave, newSave, validateSave, SAVE_KEY } from './save';
import { computeXp, rankFor, recordCompletion, totalXp } from './progress';

const memStore = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('save', () => {
  it('starts fresh when empty', () => expect(loadSave(memStore()).data).toEqual(newSave()));
  it('recovers from corrupted JSON and keeps a backup', () => {
    const st = memStore({ [SAVE_KEY]: '{not json' });
    const r = loadSave(st);
    expect(r.recovered).toBe(true);
    expect(st.m.get(SAVE_KEY + '.corrupt-backup')).toBe('{not json');
  });
  it('sanitizes bad values', () => {
    const v = validateSave({ version: 1, nickname: 'x'.repeat(50), settings: { sensitivity: 99, quality: 'insane' }, missions: { s1: { bestXp: -5 } } })!;
    expect(v.nickname).toHaveLength(20);
    expect(v.settings.sensitivity).toBe(3);
    expect(v.settings.quality).toBe('medium');
    expect(v.missions.s1.bestXp).toBe(0);
  });
  it('rejects wrong versions', () => expect(validateSave({ version: 2 })).toBeNull());
  it('export/import round trip', () => {
    const s = newSave(); s.nickname = 'Boudy';
    expect(importSave(exportSave(s))?.nickname).toBe('Boudy');
    expect(importSave('garbage')).toBeNull();
  });
});

describe('progress', () => {
  it('computes xp with bonuses and penalties', () => {
    expect(computeXp(300, 0, 100_000, 300).total).toBe(475);
    expect(computeXp(300, 2, 400_000, 300).total).toBe(200);
  });
  it('replays only add the difference', () => {
    const s = newSave();
    const a = recordCompletion(s, 's1', computeXp(300, 2, 400_000, 300), 400_000, 2, ['s1']);
    expect(a.gained).toBe(200);
    const b = recordCompletion(s, 's1', computeXp(300, 0, 100_000, 300), 100_000, 0, ['s1']);
    expect(b.gained).toBe(275);
    expect(totalXp(s)).toBe(475);
    expect(s.achievements).toEqual(expect.arrayContaining(['first_mission', 'no_hints', 'speedrunner', 'lab_soc']));
  });
  it('ranks', () => {
    expect(rankFor(0).id).toBe('trainee');
    expect(rankFor(600).id).toBe('analyst');
    expect(rankFor(20000).progress).toBe(1);
  });
});
