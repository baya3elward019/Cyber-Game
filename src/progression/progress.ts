import type { SaveData } from './save';

export const RANKS = [
  { id: 'trainee', xp: 0 },
  { id: 'analyst', xp: 500 },
  { id: 'specialist', xp: 1500 },
  { id: 'senior', xp: 3500 },
  { id: 'architect', xp: 6500 },
  { id: 'master', xp: 10000 },
] as const;

export const HINT_COST = 50;
export const NO_HINT_BONUS = 100;
export const SPEED_BONUS = 75;

export function totalXp(save: SaveData): number {
  return Object.values(save.missions).reduce((s, m) => s + m.bestXp, 0) + (save.bonusXp ?? 0);
}

export function rankFor(xp: number) {
  let idx = 0;
  RANKS.forEach((r, i) => { if (xp >= r.xp) idx = i; });
  const cur = RANKS[idx];
  const next = RANKS[idx + 1] ?? null;
  const progress = next ? (xp - cur.xp) / (next.xp - cur.xp) : 1;
  return { index: idx, id: cur.id, next, progress };
}

export interface XpBreakdown { base: number; hintPenalty: number; noHintBonus: number; speedBonus: number; total: number }

export function computeXp(baseXp: number, hintsUsed: number, timeMs: number, parTimeSec: number): XpBreakdown {
  const hintPenalty = Math.min(baseXp - 50, hintsUsed * HINT_COST);
  const noHintBonus = hintsUsed === 0 ? NO_HINT_BONUS : 0;
  const speedBonus = timeMs <= parTimeSec * 1000 ? SPEED_BONUS : 0;
  return { base: baseXp, hintPenalty, noHintBonus, speedBonus, total: baseXp - hintPenalty + noHintBonus + speedBonus };
}

export interface CompletionResult { xp: XpBreakdown; gained: number; newBest: boolean; newAchievements: string[] }

/** Records a mission completion into the save (mutates it). Replays only add XP if they beat the best score. */
export function recordCompletion(save: SaveData, missionId: string, xp: XpBreakdown, timeMs: number, hintsUsed: number, labMissionIds: string[], allLabs: string[][] = []): CompletionResult {
  const prev = save.missions[missionId] ?? { completed: false, bestXp: 0, bestTimeMs: null, fewestHints: null, attempts: 0 };
  const gained = Math.max(0, xp.total - prev.bestXp);
  save.missions[missionId] = {
    completed: true,
    bestXp: Math.max(prev.bestXp, xp.total),
    bestTimeMs: prev.bestTimeMs === null ? timeMs : Math.min(prev.bestTimeMs, timeMs),
    fewestHints: prev.fewestHints === null ? hintsUsed : Math.min(prev.fewestHints, hintsUsed),
    attempts: prev.attempts,
  };
  const newAchievements = evaluateAchievements(save, { missionId, hintsUsed, timeMs, labMissionIds, allLabs });
  return { xp, gained, newBest: gained > 0, newAchievements };
}

export const ACHIEVEMENTS = ['first_mission', 'no_hints', 'speedrunner', 'cli_native', 'lab_soc', 'all_labs', 'escape', 'escape_all', 'red_alert', 'daily_3'] as const;

export function evaluateAchievements(save: SaveData, ctx?: { missionId: string; hintsUsed: number; timeMs: number; labMissionIds: string[]; allLabs?: string[][] }): string[] {
  const earned: string[] = [];
  const give = (id: string) => { if (!save.achievements.includes(id)) { save.achievements.push(id); earned.push(id); } };
  if (Object.values(save.missions).some((m) => m.completed)) give('first_mission');
  if (save.stats.commands >= 100) give('cli_native');
  if (ctx) {
    if (ctx.hintsUsed === 0) give('no_hints');
    if (ctx.timeMs < 180_000) give('speedrunner');
    if (ctx.missionId.startsWith('s') && ctx.labMissionIds.every((id) => save.missions[id]?.completed)) give('lab_soc');
    if (ctx.allLabs?.length === 6 && ctx.allLabs.every((ids) => ids.some((id) => save.missions[id]?.completed))) give('all_labs');
  }
  return earned;
}
