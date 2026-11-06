# Assets

Phase 1 uses no external files: all equipment is built procedurally in `src/world/equipment.ts` and all textures are drawn on canvases in `src/world/textures.ts`.

Planned for a later phase: an asset registry that loads optional GLB models from `public/models/` (for example `server_rack.glb`, `switch_48p.glb`, `router.glb`, `monitor.glb`) and falls back to the procedural versions when a file is missing. Only CC0 or CC-BY models should be used, and each must be listed in `CREDITS.md`.
