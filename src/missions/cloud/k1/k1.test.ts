import { describe, expect, it } from 'vitest';
import { missionK1, LEAKY, WEBSITE } from './mission';

describe('K1', () => {
  it('website objective starts satisfied, others not', () => {
    expect(missionK1.createSession().status()).toEqual({ find: false, private: false, encrypt: false, website: true });
  });
  it('solution', () => {
    const s = missionK1.createSession(); const r = (l: string) => s.console!.run(l).text;
    expect(r('nxcloud storage ls')).toContain(LEAKY);
    expect(r(`nxcloud storage get-bucket-policy ${LEAKY}`)).toContain('"Principal": "*"');
    r(`submit bucket ${LEAKY}`);
    r(`nxcloud storage put-public-access-block ${LEAKY} --block-all`);
    r(`nxcloud storage put-encryption ${LEAKY} --algorithm AES256`);
    expect(s.status()).toEqual({ find: true, private: true, encrypt: true, website: true });
  });
  it('blocking the website breaks it', () => {
    const s = missionK1.createSession();
    s.console!.run(`nxcloud storage put-public-access-block ${WEBSITE} --block-all`);
    expect(s.takeFeedback()?.key).toBe('fb.k1.websiteDown');
    expect(s.status().website).toBe(false);
  });
});
