import { describe, expect, it } from 'vitest';
import { STAGES, PATIENT_ZERO, LEAKED_KEY, CI_KEY, CLEAN_SNAPSHOT } from './stages';
import { makeDaily, dailyMission, recordDaily } from '../daily/daily';

const run = (s: any, l: string) => s.console.run(l).text as string;

describe('red alert stages', () => {
  it('ra1: earliest encryption is patient zero', () => {
    const s = STAGES[0].createSession();
    expect(run(s, 'grep encrypt edr_alerts.log | sort | head -n 1')).toContain(PATIENT_ZERO);
    run(s, 'submit host FIN-WS-04'); expect(s.takeFeedback()?.key).toBe('ra.fb.notFirst');
    run(s, `submit host ${PATIENT_ZERO}`); expect(s.status().host).toBe(true);
  });
  it('ra2: isolate only the infected port', () => {
    const s = STAGES[1].createSession();
    ['en', 'conf t', 'int fa0/7', 'shutdown'].forEach((l) => run(s, l));
    expect(s.status().isolate).toBe(true);
  });
  it('ra3: disabling the CI key is a mistake', () => {
    const s = STAGES[2].createSession();
    run(s, `nxcloud iam deactivate-access-key ${CI_KEY}`);
    expect(s.takeFeedback()?.key).toBe('ra.fb.ciKey');
    run(s, `nxcloud iam deactivate-access-key ${LEAKED_KEY}`);
    expect(s.status().key).toBe(false);
  });
  it('ra3: correct', () => {
    const s = STAGES[2].createSession(); run(s, `nxcloud iam deactivate-access-key ${LEAKED_KEY}`);
    expect(s.status().key).toBe(true);
  });
  it('ra4: newest intact backup', () => {
    const s = STAGES[3].createSession();
    const out = run(s, 'sha256sum -c SHA256SUMS');
    expect(out).toContain('snap-2026-11-06.tar: FAILED');
    run(s, `restore ${CLEAN_SNAPSHOT}`); expect(s.status().restore).toBe(true);
  });
});

describe('daily', () => {
  it('deterministic per date and solvable', () => {
    for (const k of ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']) {
      expect(makeDaily(k)).toEqual(makeDaily(k));
      const p = makeDaily(k);
      const s = dailyMission(k).createSession();
      if (p.type === 'topip') expect(run(s, `grep -oE "203\\.0\\.113\\.[0-9]+" auth.log | sort | uniq -c | sort -nr | head -n 1`)).toContain(p.answer);
      if (p.type === 'integrity') expect(run(s, 'sha256sum -c SHA256SUMS')).toContain(`${p.answer}: FAILED`);
      run(s, `submit answer ${p.answer}`);
      expect(s.status().answer).toBe(true);
    }
  });
  it('streaks', () => {
    const d = { last: '', streak: 0, total: 0 };
    expect(recordDaily(d, '2026-11-10')).toBe(true);
    expect(recordDaily(d, '2026-11-10')).toBe(false);
    recordDaily(d, '2026-11-11'); expect(d.streak).toBe(2);
    recordDaily(d, '2026-11-13'); expect(d.streak).toBe(1);
  });
});
