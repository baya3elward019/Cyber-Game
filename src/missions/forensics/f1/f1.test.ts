import { describe, expect, it } from 'vitest';
import { missionF1, TAMPERED } from './mission';

describe('F1', () => {
  it('sha256sum -c finds exactly the tampered file', () => {
    const s = missionF1.createSession();
    const out = s.console!.run('sha256sum -c SHA256SUMS').text;
    expect(out).toContain(`${TAMPERED}: FAILED`);
    expect(out.match(/: OK/g)).toHaveLength(4);
  });
  it('exiftool reveals the editor and the solution completes', () => {
    const s = missionF1.createSession();
    expect(s.console!.run(`exiftool ${TAMPERED}`).text).toContain('m.farouk');
    s.console!.run(`submit file ${TAMPERED}`);
    s.console!.run('submit user m.farouk');
    expect(s.status()).toEqual({ file: true, user: true });
  });
  it('original author is not the answer', () => {
    const s = missionF1.createSession();
    s.console!.run('submit user accounts.orion');
    expect(s.takeFeedback()?.key).toBe('fb.f1.author');
  });
});
