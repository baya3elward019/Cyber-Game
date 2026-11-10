import type { MissionDef, Feedback } from '../../types';
import { buildSwitch } from '../n1/mission';
import type { IosSwitch } from '../../../terminals/ios/IosSwitch';

export function n2Status(sw: IosSwitch): Record<string, boolean> {
  const v = (p: string) => sw.iface(p)!.vlan;
  return {
    vlans: sw.vlans.get(20)?.toUpperCase() === 'FINANCE' && sw.vlans.get(30)?.toUpperCase() === 'GUEST',
    assign: v('Fa0/2') === 20 && v('Fa0/4') === 30 && v('Fa0/1') === 1 && v('Fa0/3') === 1 && sw.iface('Gi0/1')!.mode === 'trunk',
    save: sw.gen > 0 && sw.savedGen === sw.gen,
  };
}

export const missionN2: MissionDef = {
  id: 'n2', lab: 'network', order: 2, baseXp: 350, hintCount: 3, parTime: 360,
  createSession() {
    let feedback: Feedback | null = null;
    const warned = new Set<string>();
    const sw = buildSwitch((s) => {
      for (const p of ['Fa0/1', 'Fa0/3']) if (s.iface(p)!.vlan !== 1 && !warned.has(p)) { warned.add(p); feedback = { ok: false, key: 'fb.n2.wrongPort' }; }
      if (s.iface('Gi0/1')!.mode !== 'trunk' && !warned.has('trunk')) { warned.add('trunk'); feedback = { ok: false, key: 'fb.n2.trunk' }; }
    });
    return {
      console: sw,
      objectives: ['vlans', 'assign', 'save'],
      status: () => n2Status(sw),
      takeFeedback: () => { const f = feedback; feedback = null; return f; },
      motd: 'SW-ACCESS-01 — Cisco Catalyst 2960\nConsole connected.\nType ? at any prompt for help.\n',
    };
  },
};
