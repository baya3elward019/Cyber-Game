# NEXUS Cyber Academy

A first-person 3D cybersecurity training game that runs in the browser. Walk through a realistic security academy, sit at a SOC workstation, and investigate incidents with real Linux commands — all simulated and safe.

**Status: v0.1 (Phase 1).** The lobby, the SOC lab and mission **S1 — Brute force investigation** are fully playable. The other five labs (Network Security, Secure Coding, Cloud Security, Digital Forensics, Cryptography & CTF) are visible but locked, labeled "opens in a future update".

## What works

- First-person movement with collision, sprint, jump and interaction.
- Realistic procedural environment: lobby, server hall, SOC lab with racks, workstations and live dashboards.
- Mission S1 in a simulated Linux terminal with real command behavior: pipes, `grep`, `awk`, `sort`, `uniq -c`, `sudo ufw`, `usermod`, Tab completion and history.
- Hints (cost XP), specific feedback on wrong answers, a debrief explaining the lesson, XP, ranks and achievements.
- Progress saved in the browser, with export and import as a JSON file.
- Arabic (RTL) and English.
- Graphics quality (Low / Medium / High / Ultra), mouse sensitivity, audio volumes.
- Developer overlay: press **F3** or open the game with `?dev=1`.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look |
| Shift | Sprint |
| Space | Jump |
| E | Interact |
| Tab (hold) | Show current objective |
| Esc | Pause / leave terminal |

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev       # development server
npm test          # unit tests
npm run build     # production build in dist/
npm run preview   # serve the production build
```

## Deploy to GitHub Pages

1. Create a GitHub repository and upload all files from this folder (including the hidden `.github` folder). Do not upload `node_modules` or `dist`.
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to the `main` branch. The workflow in `.github/workflows/deploy.yml` runs the tests, builds the game and publishes it.
4. The game will be available at `https://USERNAME.github.io/REPOSITORY/`.

The build uses a relative base path, so it works under any repository name without changes.

## Feedback button

Open `src/core/config.ts` and set `feedbackUrl`, for example:

```ts
feedbackUrl: 'https://github.com/USERNAME/REPOSITORY/issues/new',
```

The button stays hidden while this is empty.

## Project structure

```
src/
  core/          game loop, state, config
  world/         lobby, labs, procedural equipment and textures
  player/        first-person controller and collision
  missions/      mission definitions, data, validators and tests
  terminals/     simulated Linux shell
  ui/            menus, HUD, mission terminal UI
  progression/   save system, XP, ranks, achievements
  audio/         synthesized sound effects
  i18n/          English and Arabic text
docs/GAME_SPEC.md   full game specification
CLAUDE.md           rules for working on this repo with Claude Code
```

## Adding a mission

Create a folder under `src/missions/<lab>/<id>/` with `data.ts`, `validator.ts`, `validator.test.ts` and `mission.ts`, register it in `src/missions/registry.ts`, and add its text keys to both `src/i18n/en.json` and `src/i18n/ar.json`. A test fails if a key is missing in Arabic.

## Safety

All scenarios, people, companies and logs are fictional. IP addresses come from documentation-only ranges (RFC 5737) and private ranges. No real systems are contacted and no player input is ever executed as code.
"# Cyber-Game" 
