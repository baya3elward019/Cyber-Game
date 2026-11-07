import { describe, expect, it } from 'vitest';
import { missionX1, FLAG } from './mission';

describe('X1', () => {
  it('the intended pipeline decodes the message', () => {
    const s = missionX1.createSession();
    const out = s.console!.run(`cat intercept.txt | xxd -r -p | base64 -d | tr 'A-Za-z' 'N-ZA-Mn-za-m'`).text;
    expect(out).toContain(FLAG);
    expect(out).toContain('02:00');
  });
  it('solution and the "forgot ROT13" mistake', () => {
    const s = missionX1.createSession();
    s.console!.run('submit flag ARKHF{lnlref_ner_abg_rapelcgvba}');
    expect(s.takeFeedback()?.key).toBe('fb.x1.stillRot');
    s.console!.run(`submit flag ${FLAG}`);
    s.console!.run('submit time 02:00');
    expect(s.status()).toEqual({ flag: true, time: true });
  });
});
