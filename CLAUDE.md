# CLAUDE.md — NEXUS: Cyber Academy

This file holds the standing rules for this repository. The full game specification is in `docs/GAME_SPEC.md`. Read both before doing any work.

## Working rules

1. Work on ONE phase at a time (phases are defined in `docs/GAME_SPEC.md`, section 13). When the phase is done, STOP and report. Never start the next phase unless the user asks.
2. At the end of every phase, report in this format:
   - What is fully working and playable (and how to test it).
   - What is partial or stubbed (be explicit).
   - Build result (`npm run build`) and test result (`npm test`).
   - Known issues.
3. Never present a feature as done unless it actually works in the browser. No fake buttons, fake loading bars, or decorative interactions that do nothing. If something is not implemented yet, hide it or label it "Coming soon".
4. Run `npm run build` and `npm test` before reporting. Fix errors; do not report a broken build as complete.
5. Commit at the end of each phase with a clear message.

## Technical rules

- TypeScript (strict mode), Vite, Three.js. No other 3D or physics engine.
- Vite `base` must work under `https://USERNAME.github.io/REPOSITORY/`. Load every asset through `import.meta.env.BASE_URL`; never use absolute paths starting with `/`.
- Missions are data-driven: every mission is a config/data file plus a validator. Adding a mission must not require editing the engine.
- All UI text goes through the i18n system (`t('key')`). No hard-coded user-facing strings. Arabic must render RTL correctly.
- All mission validators are pure functions with unit tests (Vitest).
- Never `eval` or execute player-written code. Validate code puzzles with deterministic rule checks.
- All "attack" content is simulated, fictional, and educational. Use only documentation IP ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), private ranges, and `example.com`/`example.org` domains. No real malware, real exploits, or real third-party targets.
- No secrets, API keys, or backend. Static site only.
- Every third-party asset must be CC0 or CC-BY and listed in `CREDITS.md` with source and license.
- Keep the initial download small (target < 15 MB total, < 5 MB before the lobby is playable).
