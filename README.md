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
- Chaîne de capture : popup → service worker → offscreen document, mix micro + onglet avec
  ré-injection du son, chunks écrits en OPFS pendant l'enregistrement.
- Test d'intégration : session complète dans Chromium (enregistrement → chunks → faux endpoint
  → merge → markdown téléchargé), `npm run test:e2e`.
- Transcription : providers Mistral / OpenAI / custom, pipeline chunks → merge → export Markdown,
  téléchargement en fin de session.
- UI popup (start/stop, durée, niveaux) et page de réglages (fournisseur, clés, options), en anglais.
- Badge « REC » sur l'icône de la barre d'outils pendant l'enregistrement : reste visible même si
  le popup s'est refermé (changement d'onglet, clic ailleurs).
- Logo et icônes de l'extension (16/32/48/128). Le point central du logo est rouge pendant
  l'enregistrement et gris au repos : l'icône porte l'état, en plus du badge « REC ».
- Rappel d'enregistrement : une notification système à l'ouverture d'une page de visio, sur une
  liste d'URLs pré-remplie et éditable dans les réglages. Rien n'est enregistré automatiquement.

À venir :

- Page de session (`ui/record.html`) : suivi détaillé hors popup.
- Conversion 16 kHz mono en repli si une API refuse le webm/opus brut.
- Outillage de validation manuelle contre une vraie API en place (`npm run test:real-api`), mais
  jamais encore exécuté pour de vrai contre Mistral/OpenAI, ni sur une vraie visio.

## Limites connues

- **Jamais confronté à une vraie API ni à une vraie visio.** Une session complète tourne dans
  Chromium contre un faux endpoint local, mais la forme réelle des réponses Mistral/OpenAI n'a
  jamais été vue, et aucune visioconférence réelle n'a été enregistrée.
- **`chrome.tabCapture` n'est pas couvert par les tests.** Le grant `activeTab` n'existe que si
  l'utilisateur invoque lui-même l'extension ; aucune automatisation ne peut l'obtenir. Le test
  d'intégration substitue la stratégie de capture et couvre tout ce qui vient après.
- Les identifiants de locuteurs sont attribués chunk par chunk et ne sont pas rapprochés entre
  chunks ; le markdown exporté le signale, et une section « Chunk N » sépare visuellement le texte
  de chaque chunk pour rendre ce reset repérable.
- **Le rappel de réunion n'a pas été vu sur une vraie visio.** La reconnaissance d'URL est testée
  unitairement, mais la notification système elle-même (et le comportement des SPA comme Teams, qui
  changent d'URL sans recharger) reste à valider à la main.
- **Les timestamps renvoyés par le provider sont repris tels quels.** Un provider qui daterait un
  segment hors des bornes de son propre chunk produirait un transcript incohérent, sans
  avertissement. Constaté en test avec un faux endpoint mal réglé ; reste à décider s'il faut
  écarter ou borner ces segments.

## Développement

```bash
npm install
npm test          # unitaires (Vitest) — logique pure, sans navigateur
npm run typecheck
npm run build     # produit dist/, chargeable via chrome://extensions (mode développeur)
npm run test:e2e  # intégration : session complète dans Chromium (~1 min)
```

Le build écrit une extension unpacked dans `dist/` : activez le mode développeur dans
`chrome://extensions`, puis « Charger l'extension non empaquetée » et pointez sur `dist/`.

### Lancer les tests d'intégration

Ils ont besoin d'un display X (headful) et d'un Chromium. Sur une machine sans écran, un serveur
VNC suffit — inutile d'installer xvfb :

```bash
DISPLAY=:1 npm run test:e2e
```

Playwright télécharge normalement son propre Chromium (`npx playwright install chromium`). Si un
build est déjà présent sur la machine avec une révision différente de celle qu'attend Playwright,
pointez dessus plutôt que de retélécharger :

```bash
OMR_CHROMIUM=~/.cache/ms-playwright/chromium-1232/chrome-linux64/chrome DISPLAY=:1 npm run test:e2e
```

### Valider avec une vraie API (manuel, hors CI)

`npm test` et `npm run test:e2e` n'appellent jamais de vraie API (règle du projet : provider mock
obligatoire en CI). Pour vérifier de temps en temps que le pipeline tient face à une vraie réponse
Mistral/OpenAI — sans payer à chaque `git push` — il y a un troisième test, à part et manuel :
`tests/manual/real-api.manual.ts`, lancé uniquement via `npm run test:real-api`.

Il découpe un vrai fichier audio (assez long pour produire plusieurs chunks) avec `ffmpeg`, envoie
chaque chunk au provider choisi, puis écrit le markdown obtenu dans `test-results/` (ignoré par git)
pour relecture. Rien n'est commité, rien n'est loggé — la clé API ne sert qu'à l'en-tête HTTP.

Le fichier audio de test se pose dans `tests/manual/audio/` (ignoré par git, dans le dépôt pour la
commodité du chemin). Les clés API, elles, restent hors du dépôt (ex. un fichier source dans le
home) :

```bash
# ~/.config/openmeetrec/test.env — jamais dans le dépôt
export MISTRAL_API_KEY=...   # ou OPENAI_API_KEY selon le provider
```

```bash
source ~/.config/openmeetrec/test.env
export OMR_TEST_AUDIO=tests/manual/audio/long-recording.webm   # quelques minutes, plusieurs chunks
OMR_TEST_PROVIDER=mistral npm run test:real-api
OMR_TEST_PROVIDER=openai npm run test:real-api
```

Variables optionnelles : `OMR_TEST_MODEL`, `OMR_TEST_DIARIZE=1`, `OMR_TEST_CHUNK_DURATION` /
`OMR_TEST_OVERLAP` (secondes — utile pour forcer plusieurs chunks sur un fichier plus court sans
changer les valeurs par défaut du produit), `OMR_TEST_ENDPOINT` (provider `custom`).

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
