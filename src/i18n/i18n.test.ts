import { describe, expect, it } from 'vitest';
import en from './en.json';
import ar from './ar.json';

describe('i18n', () => {
  it('Arabic has every English key', () => {
    const missing = Object.keys(en).filter((k) => !(k in ar));
    expect(missing).toEqual([]);
  });
  it('placeholders match', () => {
    for (const [k, v] of Object.entries(en)) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(ph((ar as Record<string, string>)[k]), k).toBe(ph(v));
    }
  });
});
