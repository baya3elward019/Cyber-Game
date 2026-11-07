import type { LabId, MissionDef } from './types';
import { missionS1 } from './soc/s1/mission';
import { missionN1 } from './network/n1/mission';
import { missionC1 } from './coding/c1/mission';
import { missionK1 } from './cloud/k1/mission';
import { missionF1 } from './forensics/f1/mission';
import { missionX1 } from './crypto/x1/mission';

/** Every playable mission. Add new missions here. */
export const MISSIONS: MissionDef[] = [missionS1, missionN1, missionC1, missionK1, missionF1, missionX1];

export const missionById = (id: string) => MISSIONS.find((m) => m.id === id);
export const missionsInLab = (lab: LabId) => MISSIONS.filter((m) => m.lab === lab).sort((a, b) => a.order - b.order);
