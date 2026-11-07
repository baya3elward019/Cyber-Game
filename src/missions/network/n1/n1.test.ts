import { describe, expect, it } from 'vitest';
import { missionN1 } from './mission';

const run = (s: ReturnType<typeof missionN1.createSession>, lines: string[]) => lines.map((l) => s.console!.run(l).text);

describe('IOS engine + N1', () => {
  it('modes and prompts', () => {
    const s = missionN1.createSession();
    expect(s.console!.prompt).toBe('SW-ACCESS-01>');
    run(s, ['en', 'conf t']);
    expect(s.console!.prompt).toBe('SW-ACCESS-01(config)#');
    run(s, ['int range fa0/5 - 12']);
    expect(s.console!.prompt).toBe('SW-ACCESS-01(config-if-range)#');
  });
  it('rejects port-security on a dynamic port, like real IOS', () => {
    const s = missionN1.createSession();
    const out = run(s, ['enable', 'configure terminal', 'interface fa0/1', 'switchport port-security']);
    expect(out[3]).toContain('Command rejected: FastEthernet0/1 is a dynamic port.');
  });
  it('invalid input', () => {
    const s = missionN1.createSession();
    expect(s.console!.run('hello').text).toContain("% Invalid input detected at '^' marker.");
  });
  it('full solution completes all objectives', () => {
    const s = missionN1.createSession();
    run(s, ['en', 'show interfaces status', 'conf t', 'interface range fa0/5 - 12', 'shutdown', 'exit',
      'int fa0/1', 'switchport mode access', 'switchport port-security', 'switchport port-security maximum 1',
      'switchport port-security violation shutdown', 'switchport port-security mac-address sticky', 'end']);
    expect(s.status()).toEqual({ unused: true, portsec: true, save: false });
    run(s, ['copy running-config startup-config']);
    expect(s.status()).toEqual({ unused: true, portsec: true, save: true });
    expect(s.console!.run('show port-security').text).toContain('Fa0/1');
  });
  it('shutting a used port warns and blocks the objective', () => {
    const s = missionN1.createSession();
    run(s, ['en', 'conf t', 'int range fa0/1 - 12', 'shut']);
    expect(s.takeFeedback()?.key).toBe('fb.n1.cutOff');
    expect(s.status().unused).toBe(false);
  });
  it('saving then changing again makes save stale', () => {
    const s = missionN1.createSession();
    run(s, ['en', 'conf t', 'int fa0/5', 'shut', 'end', 'wr']);
    expect(s.status().save).toBe(true);
    run(s, ['conf t', 'int fa0/6', 'shut']);
    expect(s.status().save).toBe(false);
  });
});
