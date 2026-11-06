import type { LabId, MissionDef } from './types';
import { missionS1 } from './soc/s1/mission';

/** Every playable mission. Add new missions here. */
export const MISSIONS: MissionDef[] = [missionS1];

export const missionById = (id: string) => MISSIONS.find((m) => m.id === id);
export const missionsInLab = (lab: LabId) => MISSIONS.filter((m) => m.lab === lab).sort((a, b) => a.order - b.order);
