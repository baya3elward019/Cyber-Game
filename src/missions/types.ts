import type { Shell } from '../terminals/linux/shell';

export type LabId = 'soc' | 'network' | 'coding' | 'cloud' | 'forensics' | 'crypto';

export interface Feedback {
  ok: boolean;
  /** i18n key shown as a toast in the player's language. */
  key: string;
}

export interface MissionSession {
  shell: Shell;
  /** Objective ids in display order. */
  objectives: string[];
  /** Which objectives are currently complete. */
  status(): Record<string, boolean>;
  /** Feedback produced by the last command, if any (consumed by the UI). */
  takeFeedback(): Feedback | null;
  /** Lines printed when the terminal opens. */
  motd: string;
}

export interface MissionDef {
  id: string;
  lab: LabId;
  order: number;
  baseXp: number;
  hintCount: number;
  /** Seconds under which the speed bonus is granted. */
  parTime: number;
  createSession(): MissionSession;
}
// i18n keys per mission follow the convention:
//   mission.<id>.title / .brief / .obj.<objectiveId> / .hint.<n> / .debrief.<n>
