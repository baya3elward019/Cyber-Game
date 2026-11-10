import type { Console } from '../terminals/types';

export type LabId = 'soc' | 'network' | 'coding' | 'cloud' | 'forensics' | 'crypto';

export interface Feedback {
  ok: boolean;
  /** i18n key shown as a toast in the player's language. */
  key: string;
}

export interface CodeTestResult { name: string; pass: boolean; detail: string }

/** A code-fixing task shown in the editor. */
export interface CodeTask {
  filename: string;
  language: string;
  initial: string;
  /** Runs the (simulated) security tests against the player's code. Never executes it. */
  test(code: string): CodeTestResult[];
}

export interface MissionSession {
  /** Terminal-style missions provide a console; code missions provide a code task. */
  console?: Console;
  code?: CodeTask;
  /** Objective ids in display order. */
  objectives: string[];
  status(): Record<string, boolean>;
  /** Feedback produced by the last action, if any (consumed by the UI). */
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
  /** Hints cost nothing (escape room, red alert, daily); value is the i18n key for the hint button. */
  freeHints?: string;
  createSession(): MissionSession;
}
// i18n keys per mission: mission.<id>.title / .brief / .obj.<objectiveId> / .hint.<n> / .debrief.<n>
