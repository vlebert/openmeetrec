# OpenMeetRec

Extension de navigateur **open source et privacy-first** pour enregistrer l'audio des visioconférences web (micro + participants distants), sur **n'importe quelle plateforme de visio**, puis le transcrire via l'API de votre choix (Mistral Voxtral ou OpenAI Whisper) et l'exporter en Markdown.

Pas de bot dans la réunion, pas de service cloud imposé, aucun envoi réseau que vous n'ayez déclenché.

> Nom de travail — peut être renommé à tout moment. Le dépôt est indépendant du nom.

- **PRD** : [`docs/PRD.md`](docs/PRD.md)
- **Architecture** : [`docs/architecture.md`](docs/architecture.md)
- **Audit des permissions** : [`docs/permissions-audit.md`](docs/permissions-audit.md)

## État

🟡 En cours de développement. MVP **Chromium uniquement** ; Firefox est hors scope, avec un point
d'extension prévu dans l'architecture.

Fait :

- PRD et architecture (v0.3), audit des permissions.
- Scaffolding : TypeScript strict, Vite, manifest MV3, build.
- Logique pure testée : planification des chunks, merge des segments, config, presets de providers,
  backoff, sémaphore, format markdown, provider mock.

À venir :

- Plomberie extension : service worker, offscreen document, mix audio, `ChunkScheduler`.
- Providers réseau (Mistral, OpenAI, custom) et pipeline complet.
- UI popup / session / paramètres.
- Tests d'intégration Playwright avec page fixture WebRTC.

## Développement

```bash
npm install
npm test          # unitaires (Vitest) — logique pure, sans navigateur
npm run typecheck
npm run build     # produit dist/, chargeable via chrome://extensions (mode développeur)
```

Le build écrit une extension unpacked dans `dist/` : activez le mode développeur dans
`chrome://extensions`, puis « Charger l'extension non empaquetée » et pointez sur `dist/`.

## Choix structurants

- **La logique fragile est pure.** Chunking, merge, config, format et politique de retry n'importent
  ni `chrome` ni le DOM : ils sont couverts par des tests unitaires qui tournent en millisecondes.
- **La capture est abstraite** derrière `CaptureStrategy`, ce qui laisse la place à Firefox sans
  réécrire le reste.
- **Les chunks sont produits pendant l'enregistrement**, pas après : l'empreinte mémoire ne dépend pas
  de la durée de la réunion.
- **Les segments horodatés sont toujours demandés**, indépendamment de la diarization : c'est ce qui
  permet de supprimer le texte dupliqué aux frontières de chunks sans passe LLM.

## Origine du projet

Synthèse de plusieurs recherches :

- Le terrain « extension OSS auditable, cross-browser, avec pipeline LLM local optionnel » est
  largement vacant.
- La logique de pipeline (chunking, merge) s'inspire du projet Python
  [`supervoxtral`](../../py/supervoxtral) et est portée en TS. NB : supervoxtral fait aussi une 2e
  étape LLM (transformation) qui est hors scope MVP ici — transcription seule.
- La capture audio devra fonctionner sur Chromium **et** Firefox à terme, ce qui impose deux
  stratégies de capture (`tabCapture` côté Chromium, interception WebRTC en MAIN world côté Firefox).

## Licence

MIT.
