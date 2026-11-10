import { describe, expect, it } from 'vitest';
import { SCENARIOS, BIN_USER, CIPHER_KEY } from './scenarios';
import { flipBreaker } from './logic';
import { rot13 } from '../terminals/linux/crypto';

describe('escape scenarios', () => {
  it('binary PIN decodes from the poster', () => {
    const s = SCENARIOS[1];
    expect(s.props.poster.lines.map((l) => parseInt(l.split(':')[1], 2)).join('')).toBe(s.pin);
  });
  it('cipher whiteboard decodes to the PIN words (Caesar -3)', () => {
    const dec = (w: string) => w.replace(/[A-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 65 + 23) % 26) + 65));
    expect(dec('WKUHH RQH ILYH QLQH')).toBe('THREE ONE FIVE NINE');
    expect(SCENARIOS[2].pin).toBe('3159');
    expect(rot13('A')).toBe('N');
  });
  it('binary terminal: most failures unlock', () => {
    const s = SCENARIOS[1].terminal.createSession(); const r = (l: string) => s.console!.run(l).text;
    const top = r(`awk '{print $5}' auth_failures.log | sort | uniq -c | sort -nr | head -n 1`);
    expect(top).toContain(`user=${BIN_USER}`);
    r(`unlock ${BIN_USER}`); expect(s.status().unlock).toBe(true);
  });
  it('cipher terminal: sha256 picks the genuine key', () => {
    const s = SCENARIOS[2].terminal.createSession(); const r = (l: string) => s.console!.run(l).text;
    const expected = r('cat door.sha256').trim().split('\n').pop()!;
    const sums = r('sha256sum key1 key2 key3 key4');
    expect(sums.split('\n').find((l) => l.startsWith(expected))).toContain('key3');
    r(`unlock ${CIPHER_KEY}`); expect(s.status().unlock).toBe(true);
  });
  it('breaker orders', () => {
    for (const sc of SCENARIOS) {
      let seq: string[] = []; let last = '';
      for (const b of sc.breakerOrder) { const r = flipBreaker(seq, b, sc.breakerOrder); seq = r.seq; last = r.result; }
      expect(last).toBe('done');
    }
  });
});
