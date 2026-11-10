import { describe, expect, it } from 'vitest';
import { checkPin, flipBreaker, missionEsc2, DOOR_CODE } from './logic';

describe('escape room', () => {
  it('pin', () => { expect(checkPin('3389')).toBe(true); expect(checkPin('22')).toBe(false); });
  it('breakers: right order opens, wrong trips', () => {
    let s: string[] = [];
    let r = flipBreaker(s, 'A'); expect(r.result).toBe('trip'); s = r.seq;
    r = flipBreaker(s, 'C'); expect(r.result).toBe('on'); s = r.seq;
    r = flipBreaker(s, 'A'); expect(r.result).toBe('on'); s = r.seq;
    r = flipBreaker(s, 'B'); expect(r.result).toBe('done');
  });
  it('vault terminal: hidden file, decode, unlock', () => {
    const s = missionEsc2.createSession(); const r = (l: string) => s.console!.run(l).text;
    expect(r('ls')).not.toContain('.door_code');
    expect(r('ls -a')).toContain('.door_code');
    expect(r('base64 -d .door_code')).toBe(DOOR_CODE);
    r(`unlock ${DOOR_CODE}`);
    expect(s.status()).toEqual({ unlock: true });
  });
});
