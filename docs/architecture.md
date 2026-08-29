# OpenMeetRec — Architecture

> Version 0.3. MVP Chromium. Firefox hors scope mais point d'extension prévu.
>
> Changements v0.2 → v0.3 : surface de contrôle en **popup** (ciblage explicite de l'onglet),
> chunking par **recorders décalés** au lieu du record-then-slice, providers distinguant
> `supportsSegments` de `supportsDiarization`, permissions réseau restreintes aux hôtes des providers.

## 1. Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────┐
│  UI                                                           │
│  - popup.html : ouvert SUR l'onglet de visio → Start/Stop,    │
│    meters, durée, statut court                                │
│  - record.html : page de session (progression par chunk,      │
│    erreurs, download)                                         │
│  - options.html : provider/modèle, clés API, diarization,     │
│    option audio                                               │
└───────────────┬──────────────────────────────────────────────┘
                │ chrome.runtime messaging
┌───────────────▼──────────────────────────────────────────────┐
│  Background service worker (MV3)                              │
│  - machine à états de la session (idle/recording/processing)  │
│  - CaptureStrategy picker (feature detection)                 │
│  - getMediaStreamId({ targetTabId }) sur l'onglet du popup    │
│  - crée et pilote l'offscreen document                        │
│  - gère config (chrome.storage.local) + clés API              │
└───────┬───────────────────────────────────────────────────────┘
        │
   ┌────▼───────────────────────────────────────────────────┐
   │ Offscreen document                                      │
   │ - getUserMedia (micro) + getUserMedia (tab, streamId)   │
   │ - mix Web Audio → mono                                  │
   │ - ré-injection du son de l'onglet vers la sortie        │
   │ - ChunkScheduler : recorders décalés → chunks OPFS      │
   │ - recorder continu (optionnel) → piste complète OPFS    │
   └────┬───────────────────────────────────────────────────┘
        │ chunks (Blob webm/opus) + ChunkInfo
   ┌────▼───────────────────────────────────────────────────┐
   │ Pipeline (TS pur + orchestration)                       │
   │ chunks → transcribe (concurrence limitée) → merge       │
   └────┬───────────────────────────────────────────────────┘
        │
   ┌────▼───────────────────────────────────────────────────┐
   │ Providers (transcription)                               │
   │ - MistralProvider (Voxtral, segments + diarization)     │
   │ - OpenAIProvider (Whisper, segments)                    │
   │ - CustomProvider (endpoint + modèle libres)             │
   │ - MockProvider (tests)                                  │
   └────┬───────────────────────────────────────────────────┘
        │
   ┌────▼───────────────────────────────────────────────────┐
   │ Merge (coupe à mi-overlap) → Markdown → download        │
   └────────────────────────────────────────────────────────┘
```

## 2. Structure de fichiers (cible)

```
openmeetrec/
├── docs/
│   ├── PRD.md
│   ├── architecture.md
│   ├── permissions-audit.md
│   └── testing-firefox.md        # runbook (post-MVP)
├── src/
│   ├── manifest.json              # base Chromium MV3
│   ├── background/
│   │   ├── service-worker.ts       # machine à états, capture picker
│   │   └── session.ts              # état de session partagé
│   ├── offscreen/
│   │   ├── offscreen.html
│   │   └── offscreen.ts            # micro + tab + mix + ChunkScheduler
│   ├── capture/
│   │   ├── strategy.ts             # interface CaptureStrategy
│   │   ├── tabCaptureStrategy.ts   # Chromium (MVP)
│   │   ├── webrtcStrategy.ts       # Firefox (coquille vide, post-MVP)
│   │   └── detect.ts               # feature detection
│   ├── audio/
│   │   ├── mix.ts                  # mix micro + onglet → mono + monitoring
│   │   ├── chunkScheduler.ts       # recorders décalés (browser)
│   │   ├── chunking.ts             # planification des chunks (PUR)
│   │   ├── merge.ts                # merge segments / textes (PUR)
│   │   └── encode.ts               # resample 16 kHz mono, fallback API
│   ├── pipeline/
│   │   ├── pipeline.ts             # chunks → transcribe → merge → export
│   │   └── concurrency.ts          # sémaphore / mapLimit (PUR)
│   ├── providers/
│   │   ├── base.ts                 # interface + erreurs
│   │   ├── mistral.ts              # Voxtral + diarization
│   │   ├── openai.ts               # Whisper verbose_json
│   │   ├── custom.ts               # endpoint + modèle libres
│   │   ├── mock.ts                 # tests
│   │   ├── registry.ts             # presets, résolution provider (PUR)
│   │   └── retry.ts                # backoff (PUR)
│   ├── storage/
│   │   ├── opfs.ts                 # OPFS read/write/append
│   │   └── export.ts               # download markdown + audio
│   ├── config/
│   │   └── config.ts               # schéma + defaults + validation (PUR)
│   ├── ui/
│   │   ├── popup.html / popup.ts
│   │   ├── record.html / record.ts
│   │   └── options.html / options.ts
│   └── shared/
│       ├── types.ts                # Segment, ChunkInfo, Config, messages
│       ├── messages.ts             # protocole de messaging typé
│       └── format.ts               # frontmatter + blockquote (PUR)
├── tests/
│   ├── unit/                       # Vitest
│   ├── integration/                # Playwright headful
│   └── fixtures/
│       ├── meeting-page.html        # visio factice (RTCPeerConnection + sine)
│       └── audio/                  # webm/opus d'exemple
├── scripts/
│   └── build.mjs                   # orchestration build + copie manifest/assets
├── package.json tsconfig.json vite.config.ts
└── README.md
```

**Règle d'architecture.** Les modules marqués `(PUR)` n'importent jamais `chrome`/`browser` ni d'API DOM.
C'est là que vit la logique fragile, et c'est ce qui est couvert par Vitest.

## 3. Stratégie de capture

### 3.1 Interface (point d'extension Firefox)

```ts
interface CaptureStrategy {
  readonly id: 'tabcapture' | 'webrtc';
  start(tabId: number): Promise<MediaStream>;  // audio distant
  stop(): void;
}
```

`webrtcStrategy.ts` est une **coquille vide** en MVP, qui throw « Firefox non supporté ». Elle matérialise le point d'extension sans l'implémenter. Quand on étendra à Firefox, on branchera l'interception WebRTC en MAIN world sans toucher au reste.

### 3.2 `tabCaptureStrategy` (MVP, Chromium)

Le popup est ouvert **sur l'onglet de visio** : le clic sur l'icône accorde `activeTab` sur cet onglet
précis, et le popup connaît son `tabId` via `chrome.tabs.query({ active: true, currentWindow: true })`.
C'est ce `tabId` qui est transmis au service worker, ce qui supprime toute ambiguïté sur la cible.

1. Popup → SW : `START_RECORDING { tabId, tabUrl }` (dans le geste utilisateur).
2. SW : `chrome.tabCapture.getMediaStreamId({ targetTabId: tabId })` — pas de `consumerTabId`, le
   stream sera consommé par l'offscreen document de l'extension.
3. SW : crée l'offscreen document (`reasons: ['USER_MEDIA']`) s'il n'existe pas, lui passe le `streamId`.
4. Offscreen :
   - onglet : `getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } })`
   - micro : `getUserMedia({ audio: true })`
5. Mix Web Audio : deux `MediaStreamAudioSourceNode` → `GainNode` → `MediaStreamAudioDestinationNode` mono.
6. **Ré-injection** : la source « onglet » est aussi connectée à `audioContext.destination`, sinon
   `tabCapture` détourne le son et l'utilisateur n'entend plus la visio (F-CAP-06). Le micro n'est
   *jamais* ré-injecté (larsen).
7. `ChunkScheduler` sur le flux mixé (§4).

Le popup peut se fermer immédiatement après : l'état vit dans le SW + l'offscreen document (NF-07).

### 3.3 Détection

```ts
function detectStrategy(): CaptureStrategy {
  if (chrome?.tabCapture) return new TabCaptureStrategy();
  // Firefox plus tard : if (supportsMainWorld()) return new WebRTCStrategy();
  throw new Error('Capture non supportée sur ce navigateur.');
}
```

## 4. Chunking au fil de l'eau

### 4.1 Pourquoi pas le record-then-slice

La v0.2 prévoyait : enregistrement complet → `decodeAudioData` → slicing → ré-encodage. Un
`AudioBuffer` d'1 h à 48 kHz mono en float32 pèse ~690 Mo, alloués d'un coup dans l'offscreen
document. Écarté pour NF-08.

### 4.2 Recorders décalés

Avec `chunkDuration = 300 s` et `overlap = 30 s`, le pas est `step = 270 s`. Le chunk `i` couvre
`[i·step, i·step + chunkDuration]`. Deux `MediaRecorder` alternent sur le **même** `MediaStream` mixé,
décalés de `step` :

```
t=0      A ────────────────────────► chunk 0  [0, 300]
t=270            B ────────────────────────► chunk 1  [270, 570]
t=540    A ────────────────────────► chunk 2  [540, 840]
t=810            B ...
```

Au plus deux recorders actifs simultanément ; chaque `MediaRecorder` produit un webm **autonome et
décodable**. Chaque chunk terminé est écrit en OPFS puis poussé au pipeline — la transcription peut
donc démarrer avant la fin de la réunion. L'empreinte mémoire ne dépend pas de la durée.

Un **troisième recorder continu** (avec `timeslice`, fragments appendés en OPFS) tourne uniquement si
l'option « télécharger l'audio » est active, pour produire la piste complète (F-AUD-08).

### 4.3 Fin d'enregistrement

Au Stop, les recorders actifs sont arrêtés et leur chunk partiel récupéré. Deux cas particuliers :

- Le dernier chunk peut être plus court que `chunkDuration` — normal, on le garde.
- Si le Stop tombe dans la zone d'overlap, le dernier chunk peut être **entièrement contenu** dans le
  précédent (ex. stop à t=280 → chunk 1 = `[270, 280]`). Il est alors **écarté** : il n'apporte aucun
  contenu neuf et polluerait le merge.

### 4.4 Logique pure vs plomberie

| Pur (Vitest) | Navigateur |
|---|---|
| `planChunks(totalDuration, opts)` → `ChunkInfo[]` attendus | `ChunkScheduler` : timers, MediaRecorder |
| Règle d'écart du dernier chunk | Écriture OPFS |
| `merge.ts` (offsets, coupe à mi-overlap) | — |

`planChunks` reproduit exactement la boucle de `split_audio` (supervoxtral) et sert à la fois de
prédiction (progression « chunk N/M ») et d'oracle de test pour le scheduler.

### 4.5 Mapping depuis supervoxtral

Depuis `~/dev/py/supervoxtral/svx/core/` :

| supervoxtral (Python) | OpenMeetRec (TS) | Notes |
|---|---|---|
| `chunking.split_audio` (boucle start/step) | `audio/chunking.ts` `planChunks` | port pur ; le découpage réel est fait par le scheduler |
| `chunking.merge_segments` (coupe à mi-overlap) | `audio/merge.ts` `mergeSegments` | port TS pur, 1:1 |
| `chunking._adjust_timestamps` | `audio/merge.ts` `adjustTimestamps` | port TS pur |
| `chunking.merge_texts` (concat) | `audio/merge.ts` `mergeTexts` | fallback F-TR-07 uniquement |
| `pipeline._transcribe_chunked` (ThreadPool) | `pipeline/concurrency.ts` `mapLimit` | sémaphore, 4 en parallèle |
| `providers/mistral.MistralProvider` | `providers/mistral.ts` | fetch Voxtral + diarization |
| `audio.convert_audio` (ffmpeg) | `audio/encode.ts` | resample 16 kHz mono seulement si l'API le réclame |
| `meeting_audio.record_dual_wav` | `audio/mix.ts` | micro + onglet → mono |

**Divergence assumée.** `merge_texts` concatène brutalement et compte sur l'étape 2 LLM de
supervoxtral pour nettoyer l'overlap dupliqué. Cette étape 2 est hors scope MVP, donc on ne peut pas
s'appuyer dessus : le chemin nominal passe **toujours** par `mergeSegments` (§5.2), et `mergeTexts`
n'est qu'un fallback signalé à l'utilisateur.

## 5. Providers

### 5.1 Interface

```ts
interface TranscriptionProvider {
  readonly id: 'mistral' | 'openai' | 'custom' | 'mock';
  readonly supportsSegments: boolean;      // timestamps par segment
  readonly supportsDiarization: boolean;   // speaker_id sur les segments
  transcribe(audio: Blob, opts: TranscribeOpts): Promise<TranscriptionResult>;
  testKey(): Promise<boolean>;             // bouton « tester la clé »
}

interface TranscribeOpts {
  model: string;
  language?: string | null;
  diarize: boolean;   // ignoré si !supportsDiarization
}

interface TranscriptionResult {
  text: string;
  segments?: Segment[];   // présents dès que supportsSegments
}

interface Segment { text: string; start: number; end: number; speakerId?: string }
```

`supportsSegments` est distinct de `supportsDiarization` : c'est le premier qui conditionne la
qualité du merge, le second qui conditionne le format de sortie.

### 5.2 Segments toujours demandés

Le merge sans doublons repose sur les timestamps, pas sur la diarization. Les providers demandent donc
**systématiquement** des segments :

- **Mistral** : `timestamp_granularities: ["segment"]`, plus `diarize: true` si l'option est active.
  `supportsSegments = true`, `supportsDiarization = true`.
- **OpenAI** : `response_format: "verbose_json"`, `timestamp_granularities: ["segment"]`.
  `supportsSegments = true`, `supportsDiarization = false` → segments sans `speakerId`.
- **Custom** : les deux flags sont configurables (défaut `false`/`false`).
- **Mock** : déterministe, segments en dur, les deux flags à `true`.

Si `supportsSegments` est faux, le pipeline retombe sur `mergeTexts` et le markdown exporté porte un
avertissement sur les doublons possibles aux frontières de chunks (F-TR-07).

### 5.3 Modèles & endpoint

- Presets (renvoient des segments) : `voxtral-mini-latest` (Mistral), `whisper-1` (OpenAI).
- `gpt-4o-transcribe` ne supporte pas `verbose_json` : non proposé en preset, accessible via le champ
  custom avec l'avertissement F-TR-07.
- Champs custom : `endpoint` + `model`.
- Clé API par provider, `chrome.storage.local`, jamais loggée, jamais en `storage.sync`.

### 5.4 Erreurs & retry

`providers/retry.ts` (pur) : backoff exponentiel avec jitter sur 429 / 5xx / timeout réseau, plafond
de tentatives, abandon immédiat sur 401/403 (clé invalide). Un chunk en échec définitif n'annule pas
les autres : il est marqué dans le résultat et signalé dans le markdown.

## 6. Export Markdown

```markdown
---
model: voxtral-mini-latest
provider: mistral
date: 2026-04-13T12:34:56Z
duration: 1842
platform: meet.google.com
speakers: 3
extension_version: 0.1.0
---

> **Speaker 0** (00:00:12): Bonjour, on commence la réunion…
>
> **Speaker 1** (00:00:45): …
```

Sans diarization : un seul blockquote avec le texte continu (timestamps optionnels off en MVP).
Avec diarization et plus d'un chunk, une note signale que les identités de speakers ne sont pas
appariées entre chunks (PRD §6).

## 7. Config (`chrome.storage.local`)

```ts
interface Config {
  provider: 'mistral' | 'openai' | 'custom';
  model: string;
  customEndpoint?: string;
  customSupportsSegments?: boolean;
  customSupportsDiarization?: boolean;
  apiKeys: { mistral?: string; openai?: string; custom?: string };
  diarize: boolean;
  downloadAudio: boolean;    // défaut false
  language: string | null;   // null = auto
}
```

## 8. Manifest (Chromium MV3)

```json
{
  "manifest_version": 3,
  "name": "OpenMeetRec",
  "version": "0.1.0",
  "permissions": ["activeTab", "tabCapture", "offscreen", "storage", "downloads"],
  "host_permissions": ["https://api.mistral.ai/*", "https://api.openai.com/*"],
  "optional_host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background/service-worker.js", "type": "module" },
  "action": { "default_popup": "ui/popup.html", "default_title": "OpenMeetRec" },
  "options_page": "ui/options.html"
}
```

Notes :

- Pas de `content_scripts` en MVP.
- Pas de `web_accessible_resources` : aucune page web tierce n'a besoin de référencer nos ressources.
- `host_permissions` limité aux deux API supportées. `<all_urls>` est **optionnel** et demandé à la
  volée uniquement si l'utilisateur configure un endpoint custom — il n'est jamais accordé par défaut.
- `activeTab` suffit pour `tabCapture` sur l'onglet où le popup est ouvert : pas besoin de permission
  d'hôte sur les sites de visio.

## 9. Permissions audit

Document `docs/permissions-audit.md`, une entrée par permission avec sa justification, son périmètre
et ce qu'elle ne permet pas. Aucune télémétrie. CSP restrictive.

## 10. Auto-contrôle (tests)

### 10.1 Niveau 1 — Unitaires (Vitest, sans navigateur)

Le plus rentable, car la logique fragile est **pure** :

- `audio/chunking.ts` : `planChunks` — bornes, durée < seuil, durée exactement au seuil, écart du
  dernier chunk contenu dans l'overlap.
- `audio/merge.ts` : `mergeSegments` (coupe à mi-overlap, offsets, 1 chunk / N chunks),
  `mergeTexts`, `adjustTimestamps`.
- `config/config.ts` : defaults, validation, résolution provider/modèle.
- `providers/registry.ts` : presets, capacités par provider.
- `providers/retry.ts` : backoff, abandon sur 401, plafond de tentatives.
- `pipeline/concurrency.ts` : `mapLimit` — ordre préservé, concurrence respectée, propagation d'erreur.
- `capture/detect.ts` : feature detection sur mocks de `chrome`.
- `shared/format.ts` : frontmatter + blockquote, avec/sans diarization, avertissements.

### 10.2 Niveau 2 — Audio réel (Playwright, contexte navigateur)

- Fixture `tests/fixtures/audio/*.webm`.
- `ChunkScheduler` sur un flux synthétique accéléré : assert que les chunks produits correspondent à
  `planChunks`, que chaque chunk est décodable, et que l'overlap est bien présent.

### 10.3 Niveau 3 — Intégration (Playwright headful, extension unpacked)

Chromium headful sous xvfb, `--load-extension` :

- `record.spec.ts` : popup → Start sur `meeting-page.html` → Stop → assert `.md` téléchargé avec
  frontmatter + blockquote.
- `capture-tabcapture.spec.ts` : `tabCapture` sans picker, assert `.webm` non vide **et** son de
  l'onglet toujours audible (ré-injection présente dans le graphe audio).
- `providers.spec.ts` : provider **mock** → transcript déterministe.
- `options.spec.ts` : config persistée, « tester la clé » mocké, clé jamais loggée.

**Provider mock obligatoire** : pas de réseau, pas de clé API en CI.

### 10.4 Page fixture WebRTC (`tests/fixtures/meeting-page.html`)

Page factice qui crée un `AudioContext` + `OscillatorNode` (sine 440 Hz) → `MediaStreamDestination`,
monte un `RTCPeerConnection` loopback transportant la piste, et override `getUserMedia` pour renvoyer
la sine-wave. Capture testable **sans vraie visio, sans micro, sans réseau**, de façon déterministe.
Réutilisable pour le path Firefox plus tard.

### 10.5 Ce que Playwright ne couvre pas

| Cas | Contournement |
|---|---|
| `getDisplayMedia` (picker système) | Non utilisé en MVP (`tabCapture` à la place) |
| Extension Firefox | Non supporté par Playwright → `firefox-mcp` exploratoire, post-MVP |
| Vrai micro matériel | Override `getUserMedia` en MAIN world de test (sine-wave) |
| Transcription réelle (Mistral/OpenAI) | Validation manuelle hors CI, clés jamais commitées |

### 10.6 CI

- `npm test` : Vitest (unitaires) → rapide.
- `npm run test:e2e` : Playwright headful sous xvfb.

### 10.7 Synthèse

L'essentiel de la robustesse vient des tests unitaires sur la logique pure (chunking/merge/config/
format/retry/concurrency) — c'est là qu'on investit en premier, entièrement automatisable. Playwright
complète pour la plomberie extension (popup/options/downloads/tabCapture) avec une page fixture
WebRTC. Firefox sera couvert plus tard via `firefox-mcp` puis geckodriver.

L'architecture est donc **motivée par la testabilité** : capture abstraite, provider mock, logique
pure isolée, planification de chunks séparée de leur production. Ce sont des décisions de conception,
pas une rustine.
