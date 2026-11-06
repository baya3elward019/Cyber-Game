# GAME SPEC — NEXUS: Cyber Academy

A browser-based, first-person 3D cybersecurity training game. The player explores a realistic security academy, walks into six labs, and solves hands-on security problems on realistic-looking equipment: typing real router commands, fixing vulnerable code, investigating compromised servers, and analyzing evidence.

It is hosted on GitHub Pages and shared with friends to play and give feedback.

**Primary goal:** a genuinely playable, realistic-feeling security game where every mission teaches a real skill. Gameplay depth and correctness come before visual effects.

---

## 1. Core concept

- The player is a new trainee at NEXUS Cyber Academy.
- The academy has a central lobby and six cybersecurity labs.
- Each lab contains several missions that unlock in order.
- Missions use realistic interfaces: terminals, router CLIs, code editors, cloud consoles, evidence boards.
- After every mission, a short debrief explains *why* the solution is correct and what the real-world lesson is.
- The player earns XP, ranks up, and tracks their own progress. There is no online leaderboard.

---

## 2. Tech stack

- TypeScript (strict), Vite, Three.js (latest stable).
- HTML/CSS for all 2D UI (menus, HUD, mission interfaces).
- Web Audio API for sound.
- LocalStorage for saves.
- Vitest for unit tests.
- GitHub Actions to build and deploy to GitHub Pages.
- No backend, no paid APIs, no copyrighted game assets.

---

## 3. Visual direction: realistic, not cartoon

The look is a **realistic modern security operations facility**: think a real data center and SOC, with subtle sci-fi touches. Not cartoonish, not low-poly, not neon-overload.

### Art direction
- Dark grey and graphite surfaces, brushed metal, glass, raised data-center floor tiles.
- Cool white and blue-cyan lighting; small accent colors per lab (subtle, not saturated).
- Equipment must look like real hardware: rack-mounted servers with front bezels and drive bays, switches with rows of RJ45 ports and blinking status LEDs, routers with labeled ports, monitors with bezels and stands, cable trays, patch panels.
- Screens show readable, realistic content (terminal text, dashboards, logs), rendered from canvas textures.

### Rendering
- `MeshStandardMaterial` / `MeshPhysicalMaterial` (PBR) everywhere.
- ACES Filmic tone mapping, sRGB output.
- A small (1k) CC0 HDRI environment map for realistic reflections on metal and glass.
- CC0 PBR textures (from Poly Haven or ambientCG) for floors, walls, and metal, at 1k resolution, compressed.
- Bloom only on screens and LEDs, only on High/Ultra.

### Asset strategy (important)
Third-party models may not always be downloadable automatically, so:
1. Build every piece of equipment **procedurally but with real detail**: rounded/bevelled edges, port cutouts or port textures, LED meshes (instanced), vent grilles via normal/alpha maps, label decals from canvas textures. A procedural switch must look like a switch, not a box.
2. Create an `AssetRegistry` where each equipment type (`server_rack`, `switch_48p`, `router`, `monitor`, `workstation`, `desk`, `chair`, `door`) has a procedural builder AND an optional GLB path. If a GLB exists in `public/models/`, load it; otherwise use the procedural version. This lets the user drop in better CC0/CC-BY models later without code changes.
3. Write `ASSETS.md` listing each slot, expected file name, scale/orientation conventions, and suggested free sources.
4. List every third-party asset in `CREDITS.md`.

### Graphics settings
Low / Medium / High / Ultra, auto-detected default, changeable in Settings. They control pixel ratio cap, shadow map size and count, bloom on/off, texture resolution, and environment map use. Low must run smoothly on an integrated-GPU student laptop.

---

## 4. First-person controller

- Desktop: WASD move, mouse look (Pointer Lock), Shift sprint, Space jump, E interact, ESC pause, Tab mission info.
- Gravity, realistic eye height (~1.7 m), subtle head bob (toggleable), adjustable mouse sensitivity, invert-Y option.
- Collision: player capsule approximated as a cylinder against axis-aligned boxes (AABB) for walls, furniture, and equipment, with sliding along walls. No physics engine.
- Interaction: raycast from screen center, max ~2.5 m. Interactable objects show an outline/highlight plus a prompt ("[E] Access Terminal").
- When a mission interface opens: release pointer lock, freeze movement, show the HTML mission UI. Closing it returns to first-person.
- Mobile (Phase 4): virtual joystick, drag-to-look, interact button.

---

## 5. World layout

### Lobby
- Reception area with a welcome screen showing the player's name and rank.
- Mission board: all six labs, missions completed, locked/unlocked state.
- Profile terminal: opens the player's progress page.
- Six lab doors with labeled signs, a status light (locked / available / completed), and sliding-door animation.
- Lab unlocking: Lab 1 (SOC) is open at start. Each additional lab unlocks when the player has completed at least one mission in the previous lab. (Keep this rule in one config value so it is easy to change.)

### Labs
Each lab is its own scene chunk, loaded lazily when the player approaches its door, with a short real loading indicator tied to actual asset loading. Each lab has a distinct layout and accent color, and each mission is attached to a specific physical object in the lab (a specific terminal, rack, or desk).

---

## 6. Core systems

### 6.1 Mission system (data-driven)
Each mission lives in `src/missions/<lab>/<missionId>/` and consists of:
- `mission.ts`: id, lab, order, title/description keys, objectives, XP, hint list, required interface type, the 3D object it's attached to, and the debrief text keys.
- `data.ts`: the mission's content (logs, files, code, device configs, etc.).
- `validator.ts`: pure functions that check each objective.
- `validator.test.ts`: tests for correct and incorrect solutions.

The engine provides: mission state (not started / in progress / completed), objective checklist UI, hint button, attempt/time tracking, success and failure feedback, the debrief screen, and replay.

### 6.2 Simulated Linux terminal engine
A reusable terminal component used by several labs:
- Virtual file system per mission (directories, files, permissions, metadata).
- Real command behavior over that virtual FS, including at least: `ls` (-l, -a), `cd`, `pwd`, `cat`, `head`/`tail` (-n), `grep` (-i, -v, -c, -E), `wc -l`, `sort` (-n, -r), `uniq -c`, `cut` (-d, -f), `awk '{print $N}'` (basic field printing), pipes `|`, `ps aux`, `kill`, `crontab -l` / `crontab -r`, `systemctl status|stop|disable`, `ufw deny from <ip>`, `sha256sum`, `md5sum`, `base64 -d`, `exiftool`, `history`, `clear`, `help`.
- Command history (up/down arrows), Tab completion for files and commands.
- Unknown commands return realistic errors (`bash: foo: command not found`).
- Each mission can register custom commands or override outputs.
- Objectives can be satisfied by state changes (e.g., the malicious process is killed) or by the player submitting an answer through an `submit <answer>` command or an answer panel.

### 6.3 Simulated Cisco IOS CLI engine
- Modes: user EXEC (`>`), privileged EXEC (`#`), global config (`(config)#`), interface config (`(config-if)#`), ACL config, VLAN config.
- Command abbreviations (`conf t`, `int g0/1`, `sh run`), `?` help, `exit`, `end`, `do`.
- Supported commands (subset): `enable`, `configure terminal`, `interface`, `interface range`, `ip address`, `shutdown` / `no shutdown`, `description`, `switchport mode access`, `switchport access vlan`, `switchport port-security` (maximum, violation, mac-address sticky), `vlan`, `name`, `access-list` (standard and extended), `ip access-group`, `show running-config`, `show ip interface brief`, `show vlan brief`, `show interfaces status`, `show access-lists`, `show port-security`, `ping`, `copy running-config startup-config`.
- Invalid input returns realistic IOS errors (`% Invalid input detected at '^' marker.`, `% Incomplete command.`).
- The device holds a real config state object; validators check that state, and `ping`/test traffic is computed from it.

### 6.4 Code editor
- A code panel with syntax highlighting (a lightweight library such as CodeMirror 6 is fine), line numbers, and an "Run security tests" button.
- Validation: normalize the player's code, then apply deterministic rule checks (e.g., query uses placeholders and passes parameters; user input is no longer concatenated into SQL). Never execute player code.
- The "test runner" shows realistic results: each simulated attack payload shown as PASS/FAIL based on the rule checks.

### 6.5 Other mission interfaces
- Cloud console: a realistic but fictional provider UI (call it "NexusCloud") with resource lists, toggles, JSON policy editor, and security group rule tables.
- Evidence board: drag clues onto a timeline, link evidence to suspects.
- Email viewer: raw headers view and rendered view.
- Cable patching: drag cables between device ports in a 2D panel that mirrors the 3D devices.

---

## 7. Labs and missions (v1: 3 missions per lab = 18)

All data is fictional. Use documentation IP ranges and `example.com`-style domains only.

### Lab 1: SOC & Incident Response (unlocked first)

**S1 — Brute Force Investigation** (the reference mission; implement in Phase 1, fully detailed below)

- *Setting:* SOC analyst desk with three monitors. An alert says "Unusual login activity on srv-web-01".
- *Interface:* Linux terminal with a virtual FS containing `/var/log/auth.log` (~300 lines, generated deterministically from a fixed seed), `/var/log/syslog`, and a home directory with a `notes.txt` from the shift lead.
- *Hidden scenario:* normal logins from internal IPs (10.0.x.x) by users `alice`, `bob`, `deploy`; background noise of a few random failed logins; one attacker IP `203.0.113.47` with 140+ `Failed password` lines against multiple usernames over ~6 minutes, then one `Accepted password for backup from 203.0.113.47`. A second decoy IP `198.51.100.23` has 4 failed attempts only (a distractor).
- *Objectives:*
  1. Identify the attacking IP → `submit ip 203.0.113.47`.
  2. Identify the compromised account → `submit user backup`.
  3. Contain the attack: block the IP with `ufw deny from 203.0.113.47` (state check).
  4. Disable the compromised account: `usermod -L backup` or `passwd -l backup` (add these commands for this mission).
- *Hints (each costs XP):* (1) "Failed logins are logged with the phrase 'Failed password'." (2) "Try `grep 'Failed password' /var/log/auth.log | awk '{print $11}' | sort | uniq -c | sort -nr`." (3) "Look for an `Accepted password` from the same IP."
- *Failure feedback:* submitting the decoy IP gives a specific message ("Only 4 attempts; that is noise, not an attack").
- *Debrief:* what brute force looks like in logs, why counting by IP works, why blocking alone is not enough (the account was already compromised), and real mitigations (fail2ban, MFA, key-based SSH, disabling password auth).

**S2 — Alert Triage:** a fictional SIEM dashboard with 8 alerts. The player marks each as true positive or false positive and must attach the piece of evidence that justifies the decision. Pass = all correct with evidence.

**S3 — Phishing Analysis:** an inbox with 5 emails. The player inspects raw headers and links, flags the phishing ones, and must identify the indicators (SPF fail, display-name spoofing, lookalike domain, link text vs. real URL mismatch).

### Lab 2: Network Security

**N1 — Harden the Switch:** Cisco CLI on a 24-port access switch (realistic 3D switch with blinking LEDs). Shut down all unused ports, set active user ports to access mode, and enable port security (max 1 MAC, sticky, violation shutdown) on the reception port. Validator checks the config state.

**N2 — Block the Attacker with an ACL:** a router between the office LAN and a server subnet; an attacker host at 203.0.113.0/24 is hitting the web server. Write an extended ACL that blocks the attacker from the server, still allows office users HTTP/HTTPS to the server, and apply it to the correct interface and direction. Built-in `ping` and a "traffic test" panel show which flows pass. Common mistakes (implicit deny blocking everything, wrong direction) get specific feedback.

**N3 — VLAN Segmentation:** guest devices are on the same network as finance PCs. Using the cable panel + CLI: create VLAN 10 (STAFF), 20 (FINANCE), 30 (GUEST), assign ports correctly, and verify guests can no longer reach finance hosts.

### Lab 3: Secure Coding

**C1 — SQL Injection:** a Node.js (or Python) login function concatenating user input into SQL. The player rewrites it with a parameterized query. Test runner shows payloads like `' OR '1'='1` failing after the fix.

**C2 — Cross-Site Scripting:** a comment-rendering function using `innerHTML` with user input. Fix using `textContent` or proper output encoding. Tests show `<script>` and `onerror` payloads neutralized.

**C3 — Secrets and Password Storage:** code with a hard-coded API key and passwords hashed with MD5. Move the key to an environment variable and switch to bcrypt/argon2 with a salt. Validator checks both.

### Lab 4: Cloud Security

**K1 — Exposed Storage Bucket:** in NexusCloud, find which bucket is public and contains sensitive data (by inspecting object listings), make it private, and enable encryption and access logging.

**K2 — Least-Privilege IAM:** a JSON policy with `"Action": "*"` and `"Resource": "*"` attached to an app role. Rewrite it so the app can only read from one specific bucket. Validator parses the JSON and checks actions/resources.

**K3 — Compromised Cloud Server:** SSH (simulated terminal) into a VM using 100% CPU. Find the cryptominer process (`ps aux`), its persistence (`crontab -l`), its file location, kill it, remove the persistence and the file, and close the unnecessary open port in the security group panel.

### Lab 5: Digital Forensics

**F1 — Metadata Investigation:** a seized folder of files; use `exiftool` and `ls -l` to find which document was created by the suspect's device and when.

**F2 — Evidence Integrity:** five evidence files with a chain-of-custody sheet listing SHA-256 hashes. Use `sha256sum` to find which file was tampered with, and record it in the custody log.

**F3 — Timeline Reconstruction:** an evidence board with logs, emails, access-card records, and file timestamps. Place events on a timeline in order and identify which of three suspects is consistent with all evidence. Wrong suspects get feedback about which clue contradicts them.

### Lab 6: Cryptography & CTF

**X1 — Decode the Message:** an intercepted message encoded in layers (Base64 → ROT13 → hex). Use terminal tools and a provided decoder workstation to recover the flag in the format `NEXUS{...}`.

**X2 — Weak Passwords:** a fictional leaked hash list (unsalted MD5 of very weak passwords) and a small provided wordlist. Use a simulated `crack` tool to see which passwords fall instantly, then answer which policy would have prevented it. Teaches why salting and slow hashes matter.

**X3 — Mini CTF:** a 3-step chained challenge in an isolated lab terminal: find a hidden file, decode a clue from it, then use the clue to unlock a locked archive and obtain the final flag.

---

## 8. Progression (personal only)

- Player nickname (entered at first start; changeable).
- XP per mission (base XP, minus a fixed amount per hint used, bonus for no hints, bonus for fast completion).
- Ranks by XP: Trainee → Analyst → Specialist → Senior Engineer → Security Architect → CYBER MASTER.
- Per-lab mastery percentage.
- Achievements (at least 12), e.g. "First Blood" (first mission), "No Hints Needed", "Speedrunner", "Lab Master" (all missions in a lab), "CLI Native" (100 commands typed), "Full Clearance" (all labs).
- **My Progress page:** completed missions, best time per mission, hints used, XP earned, achievements, mastery per lab. This replaces any leaderboard.
- Save in LocalStorage with a schema version; validate on load; if corrupted, back up the raw data, reset safely, and show a non-scary message.
- **Export / Import progress** as a JSON file (so testers don't lose progress when changing browsers).

---

## 9. UI / UX

Screens: main menu (3D lobby slowly orbiting in the background), nickname entry, settings, pause menu, mission briefing, mission interface, mission debrief, My Progress, achievements, controls guide, credits, feedback.

- Clean professional "security tool" look: dark panels, monospace for terminals, clear typography, no clutter.
- HUD: crosshair, interaction prompt, current objective, XP bar, rank, toast notifications for objectives/achievements.
- Every button must work. Unimplemented items are hidden or labeled "Coming soon".

### Language: Arabic + English
- Language selector on first start and in Settings.
- All UI strings in `src/i18n/en.json` and `src/i18n/ar.json`.
- Arabic switches `dir="rtl"` and mirrors layouts. Use an Arabic-capable font (e.g., Cairo or IBM Plex Sans Arabic, self-hosted, with fallback).
- Terminal content, commands, code, logs, and IPs always stay LTR and in English, even in Arabic mode (as in real life). Mission briefings, hints, objectives, and debriefs are translated.
- 3D signs inside the world can be bilingual.

### Feedback
- A "Send Feedback" button in the pause menu and main menu that opens a configurable URL (GitHub Issues new-issue link or a Google Form) in a new tab, pre-filling the game version and current mission where possible. The URL lives in one config file.

---

## 10. Audio

- Ambient data-center hum, footsteps (varies by sprint), door slide, terminal keystrokes, objective-complete chime, mission-complete sting, error buzz, alarm for incident missions.
- Generated with Web Audio API or CC0 sound files (listed in `CREDITS.md`).
- Master / music / SFX volume sliders and a mute toggle; audio starts only after the first user interaction (autoplay policy).

---

## 11. Performance

- Lazy-load each lab when the player approaches its door; dispose geometries, materials, and textures of labs that are far away.
- Share materials and geometries; use `InstancedMesh` for repeated items (LEDs, rack units, floor tiles, cables).
- Cap pixel ratio per quality level; limit shadow-casting lights.
- Compress textures (KTX2 when practical, otherwise optimized JPG/WebP).
- Developer mode (toggle with F3 or `?dev=1`): FPS counter, draw calls, and collision box display.
- Target: 60 FPS on High on a mid laptop, 30+ FPS on Low on integrated graphics.

---

## 12. Project structure

```
src/
  core/          # app bootstrap, game loop, scene manager, config
  world/         # lobby, labs, AssetRegistry, procedural equipment builders
  player/        # controller, collision, interaction raycast
  missions/      # mission engine + one folder per mission (data, validator, tests)
  terminals/     # linux terminal engine, cisco IOS engine
  ui/            # menus, HUD, mission panels, code editor, evidence board
  progression/   # XP, ranks, achievements, save/load, export/import
  audio/
  i18n/          # en.json, ar.json, t()
  utils/
public/
  models/        # optional GLB overrides
  textures/
  hdri/
  audio/
docs/
  GAME_SPEC.md
.github/workflows/deploy.yml
README.md, ASSETS.md, CREDITS.md
```

---

## 13. Phases (do one, then stop and report)

**Phase 0 — Setup**
Vite + TypeScript + Three.js + Vitest project, folder structure, GitHub Pages base path, GitHub Actions deploy workflow, i18n skeleton with RTL switching, empty README. Build and tests pass.

**Phase 1 — Playable foundation**
Realistic lobby (with PBR materials and HDRI), first-person controller with collision, interaction system, main menu, nickname entry, settings (graphics, sensitivity, audio, language), pause menu, save system with export/import, Linux terminal engine, the SOC lab room, and mission **S1 fully playable** from briefing to debrief with XP awarded and saved. Arabic and English both working for everything built so far.

**Phase 2 — All labs + first mission each**
All six lab environments with distinct realistic equipment, Cisco IOS engine, code editor, cloud console, evidence board; missions S1, N1, C1, K1, F1, X1 playable; lab unlocking; achievements; My Progress page.

**Phase 3 — Full mission set**
Remaining 12 missions (S2, S3, N2, N3, C2, C3, K2, K3, F2, F3, X2, X3), all with validators, tests, hints, and debriefs in both languages. Audio pass.

**Phase 4 — Polish and release**
Performance pass, mobile controls, visual polish, feedback button, credits, final README with screenshots and "how to play", deployed and verified on GitHub Pages.

---

## 14. Acceptance criteria for Phase 1

1. `npm run build` succeeds and `npm test` passes.
2. The game loads on GitHub Pages under a repository subpath with all assets.
3. The player can enter a nickname and switch between Arabic (RTL) and English.
4. The player can walk the lobby in first person; walls and objects block movement.
5. The lobby and equipment look realistic (PBR, reflections, detailed procedural equipment), not cartoonish.
6. The player can walk into the SOC lab, use the terminal, and complete S1 using real command pipelines.
7. Wrong answers get specific feedback; hints work and reduce XP.
8. Completing S1 awards XP, shows the debrief, and progress survives a page refresh.
9. Progress can be exported and re-imported.
10. Low quality runs smoothly on an integrated-GPU laptop.
