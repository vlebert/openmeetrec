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
- Changelog tenu à jour dans `CHANGELOG.md` (format Keep a Changelog) : ajouter une entrée pour
  chaque changement notable pour l'utilisateur ou l'intégrateur (fonctionnalité, correctif,
  changement de comportement) — pas pour du refactor interne sans effet visible.

## Testing

- Unitaires : Vitest sur `tests/unit/`.
- Intégration : `npm run test:e2e` — Playwright headful sur le display VNC existant (`DISPLAY=:1`)
  charge `dist-test/` (build de test) + la page fixture WebRTC `tests/integration/fixtures/meeting-page.html`.
  Le build de test substitue deux modules (stratégie de capture, durées de chunk) ; le code de
  production n'embarque rien de spécifique aux tests. `activeTab` étant impossible à obtenir par
  automatisation, le vrai `chrome.tabCapture` reste vérifié à la main.
- Sur cette machine : `OMR_CHROMIUM=~/.cache/ms-playwright/chromium-1232/chrome-linux64/chrome`,
  car la révision attendue par Playwright (1234) n'est pas installée et on ne retélécharge pas de
  navigateur pour deux révisions d'écart.
- Firefox exploratoire : `firefox-mcp` (Firefox réel VNC) — voir `docs/testing-firefox.md` (à créer).
- Ne pas ajouter de dépendance sans justification.

## Références

- PRD : `docs/PRD.md`
- Architecture : `docs/architecture.md` (inclut la stratégie d'auto-contrôle)
- Pipeline inspiré de `~/dev/py/supervoxtral` (chunking, merge, conversion) — à porter en TS. NB : supervoxtral fait aussi une 2e étape LLM (transformation) qui est **hors scope MVP** ici (transcription seule).
