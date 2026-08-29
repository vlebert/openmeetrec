# OpenMeetRec — AGENTS rules

Extension de navigateur OSS, **MVP Chromium uniquement** (Firefox hors scope, point d'extension prévu en architecture). Recording audio de visio + transcription.

## Conventions

- TypeScript strict, ESM, Vite pour le build.
- Build Chromium MV3. Le point d'extension Firefox (`webrtcStrategy.ts`) est une coquille vide en MVP.
- **Logique pure isolée du navigateur** : tout ce qui est chunking/merge/config/providers doit être testable sans DOM (Vitest). Ne pas importer `chrome`/`browser` dans ces modules.
- **Stratégie de capture abstraite** derrière une interface ; jamais appeler `chrome.tabCapture` directement hors `capture/`.
- **Provider mock obligatoire** pour tout test d'intégration : pas de réseau, pas de clé API dans la CI.
- Pas de télémétrie. Aucun envoi réseau non déclenché explicitement par l'utilisateur.
- Chaque permission justifiée dans `docs/permissions-audit.md`.
- Commits : messages courts en français ou anglais, au choix.

## Testing

- Unitaires : Vitest sur `tests/unit/`.
- Intégration : Playwright headful (sous xvfb) charge l'extension unpacked + page fixture WebRTC dans `tests/fixtures/meeting-page.html`.
- Firefox exploratoire : `firefox-mcp` (Firefox réel VNC) — voir `docs/testing-firefox.md` (à créer).
- Ne pas ajouter de dépendance sans justification.

## Références

- PRD : `docs/PRD.md`
- Architecture : `docs/architecture.md` (inclut la stratégie d'auto-contrôle)
- Pipeline inspiré de `~/dev/py/supervoxtral` (chunking, merge, 2-step LLM) — à porter en TS.
