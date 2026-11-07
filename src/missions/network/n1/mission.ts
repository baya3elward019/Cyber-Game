import type { MissionDef, Feedback } from '../../types';
import { IosSwitch, makePort, type Iface } from '../../../terminals/ios/IosSwitch';

export const USED = ['Fa0/1', 'Fa0/2', 'Fa0/3', 'Fa0/4', 'Gi0/1'];
export const UNUSED = Array.from({ length: 8 }, (_, i) => `Fa0/${i + 5}`);

export function buildSwitch(onChange?: (sw: IosSwitch) => void) {
  const ports: Iface[] = [
    makePort('Fa0/1', { description: 'Reception-PC', connected: true, mac: '0050.56a1.1c2e' }),
    makePort('Fa0/2', { description: 'Finance-PC', connected: true, mac: '0050.56a1.4b90', mode: 'access', vlan: 1 }),
    makePort('Fa0/3', { description: 'Printer-2F', connected: true, mac: '0021.5a9f.03d1', mode: 'access' }),
    makePort('Fa0/4', { description: 'Meeting-AP', connected: true, mac: '0c8d.db12.77a0', mode: 'access' }),
    ...UNUSED.map((p) => makePort(p, { description: 'Wall-jack' })),
    makePort('Gi0/1', { description: 'Uplink-CORE-SW', connected: true, mode: 'trunk' }),
  ];
  return new IosSwitch('SW-ACCESS-01', ports, { onChange });
}

export function n1Status(sw: IosSwitch): Record<string, boolean> {
  const p = (s: string) => sw.iface(s)!;
  const r = p('Fa0/1');
  return {
    unused: UNUSED.every((s) => p(s).shutdown) && USED.every((s) => !p(s).shutdown),
    portsec: r.mode === 'access' && r.ps.enabled && r.ps.max === 1 && r.ps.sticky && r.ps.violation === 'shutdown' && !r.shutdown,
    save: sw.gen > 0 && sw.savedGen === sw.gen,
  };
}

export const missionN1: MissionDef = {
  id: 'n1', lab: 'network', order: 1, baseXp: 300, hintCount: 3, parTime: 360,
  createSession() {
    let feedback: Feedback | null = null;
    const warned = new Set<string>();
    const sw = buildSwitch((s) => {
      for (const u of USED) if (s.iface(u)!.shutdown && !warned.has(u)) { warned.add(u); feedback = { ok: false, key: 'fb.n1.cutOff' }; }
      const r = s.iface('Fa0/1')!;
      if (r.ps.enabled && r.ps.max > 1 && !warned.has('max')) { warned.add('max'); feedback = { ok: false, key: 'fb.n1.maxHigh' }; }
    });
    return {
      console: sw,
      objectives: ['unused', 'portsec', 'save'],
      status: () => n1Status(sw),
      takeFeedback: () => { const f = feedback; feedback = null; return f; },
      motd: 'SW-ACCESS-01 — Cisco Catalyst 2960, 2nd floor wiring closet\nConsole connected. Press RETURN to get started.\n\nUser Access Verification\nType ? at any prompt for help.\n',
    };
  },
};
