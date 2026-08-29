# OpenMeetRec — Architecture

> Version 0.2. MVP Chromium. Firefox hors scope mais point d'extension prévu.

## 1. Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────┐
│  UI                                                           │
│  - record.html (onglet plein écran) : Start/Stop, meters,     │
│    statut, progression, download                             │
│  - options.html : provider/modèle, clés API, diarization,    │
│    option audio                                               │
└───────────────┬─────────────────────────────────────────────┘
                │ chrome.runtime messaging
┌───────────────▼─────────────────────────────────────────────┐
│  Background service worker (MV3)                             │
│  - orchestre record (start/stop)                             │
│  - CaptureStrategy picker (feature detection)               │
│  - crée l'offscreen document                                 │
│  - gère config (chrome.storage.local) + clés API             │
└───────┬────────────────────────────────────────────────────────┘
        │
   ┌────▼──────────────────────────────────────────────────┐
   │ Offscreen document                                     │
   │ - tient getUserMedia (micro) + tabCapture (onglet)     │
   │ - mix Web Audio → MediaRecorder (webm/opus)            │
   │ - accumulation OPFS pour les longs enregistrements     │
   └────┬──────────────────────────────────────────────────┘
        │ blob / OPFS
   ┌────▼──────────────────────────────────────────────────┐
   │ Audio pipeline (TS pur + Web Audio + WebCodecs)        │
   │ decode → chunk (overlap) → re-encode opus → storage    │
   └────┬──────────────────────────────────────────────────┘
        │
   ┌────▼──────────────────────────────────────────────────┐
   │ Providers (transcription)                             │
   │ - MistralProvider (Voxtral + diarization)             │
   │ - OpenAIProvider (Whisper)                             │
   │ - CustomProvider (endpoint + modèle libres)           │
   │ - MockProvider (tests)                                 │
   └────┬──────────────────────────────────────────────────┘
        │
   ┌────▼──────────────────────────────────────────────────┐
   │ Merge (crossfade/concat) → format Markdown → download  │
   └───────────────────────────────────────────────────────┘
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
│   │   ├── service-worker.ts       # orchestration, capture picker
│   │   └── messaging.ts
│   ├── offscreen/
│   │   ├── offscreen.html
│   │   └── offscreen.ts            # getUserMedia + tabCapture + mix + recorder
│   ├── capture/
│   │   ├── strategy.ts             # interface CaptureStrategy
│   │   ├── tabCaptureStrategy.ts   # Chromium (MVP)
│   │   ├── webrtcStrategy.ts        # Firefox (coquille vide, post-MVP)
│   │   └── detect.ts               # feature detection
│   ├── audio/
│   │   ├── mix.ts                  # mix micro + onglet → mono
│   │   ├── recorder.ts             # wrapper MediaRecorder
│   │   ├── chunking.ts             # split + overlap (port de chunking.py)
│   │   ├── merge.ts                # merge_segments / merge_texts (port)
│   │   └── encode.ts               # WebCodecs AudioEncoder (opus) + fallback
│   ├── pipeline/
│   │   ├── pipeline.ts             # record → chunk → transcribe → merge → export
│   │   └── concurrency.ts          # sémaphore (Promise.all limité)
│   ├── providers/
│   │   ├── base.ts                 # Provider interface
│   │   ├── mistral.ts              # Voxtral + diarization
│   │   ├── openai.ts               # Whisper
│   │   ├── custom.ts               # endpoint + modèle libres
│   │   └── mock.ts                 # tests
│   ├── storage/
│   │   ├── opfs.ts                 # OPFS read/write
│   │   └── export.ts               # download markdown + audio
│   ├── config/
│   │   └── config.ts               # schéma chrome.storage.local
│   ├── ui/
│   │   ├── record.html / record.ts
│   │   └── options.html / options.ts
│   └── shared/
│       ├── types.ts                # Segment, ChunkInfo, Config…
│       └── format.ts               # frontmatter + blockquote
├── tests/
│   ├── unit/                       # Vitest
│   ├── integration/                # Playwright headful
│   └── fixtures/
│       ├── meeting-page.html        # visio factice (RTCPeerConnection + sine)
│       └── audio/                  # webm/opus d'exemple
├── scripts/
│   └── build.mjs                   # build (Chromium ; Firefox post-MVP)
├── package.json tsconfig.json vite.config.ts
└── README.md
```

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

1. Service worker : `chrome.tabCapture.getMediaStreamId({ targetTabId })` après clic sur Start (user gesture).
2. StreamId passé à l'offscreen document.
3. Offscreen : `getUserMedia({ audio: { chromeMediaSource: 'tab', streamId } })` pour l'onglet + `getUserMedia({ audio: true })` pour le micro.
4. Mix via Web Audio (`MediaStreamAudioSourceNode` × 2 → `MediaStreamAudioDestinationNode` mono).
5. `MediaRecorder` sur le flux mixé → webm/opus.

### 3.3 Détection

```ts
function detectStrategy(): CaptureStrategy {
  if (chrome?.tabCapture) return new TabCaptureStrategy();
  // Firefox plus tard : if (supportsMainWorld()) return new WebRTCStrategy();
  throw new Error('Capture non supportée sur ce navigateur.');
}
```

## 4. Pipeline audio (port de supervoxtral)

Mapping depuis `~/dev/py/supervoxtral/svx/core/` :

| supervoxtral (Python) | OpenMeetRec (TS) | Notes |
|---|---|---|
| `audio.convert_audio` (ffmpeg) | `audio/encode.ts` | MediaRecorder produit déjà webm/opus ; resample 16k seulement si requis par l'API |
| `chunking.split_audio` (soundfile/ffmpeg) | `audio/chunking.ts` | decodeAudioData → slice Float32Array overlap → re-encode |
| `chunking.merge_segments` (crossfade) | `audio/merge.ts` | port TS pur |
| `chunking.merge_texts` (concat) | `audio/merge.ts` | port TS pur |
| `pipeline._transcribe_chunked` (ThreadPool) | `pipeline/concurrency.ts` | sémaphore Promise.all(4) |
| `providers/mistral.MistralProvider` | `providers/mistral.ts` | fetch Voxtral + diarization |
| `meeting_audio.record_dual_wav` | `offscreen.ts` mix | micro + onglet → mono |

### 4.1 Chunking — détail (stratégie A, record-then-slice)

1. Enregistrement complet → blob webm/opus (accumulation OPFS si long).
2. `AudioContext.decodeAudioData` → `AudioBuffer` (PCM float32).
3. Slicing sample-accurate : chunks 300 s, overlap 30 s, `step = 270 s`.
4. Re-encodage opus : **WebCodecs `AudioEncoder`** si dispo, sinon `MediaRecorder` sur un `MediaStream` reconstruit via `AudioBufferSourceNode → MediaStreamAudioDestinationNode`.
5. `ChunkInfo { index, start, end }` (port direct).

## 5. Providers

### 5.1 Interface

```ts
interface TranscriptionProvider {
  readonly id: 'mistral' | 'openai' | 'custom' | 'mock';
  readonly supportsDiarization: boolean;
  transcribe(audio: Blob, opts: TranscribeOpts): Promise<TranscriptionResult>;
  testKey(): Promise<boolean>;  // pour le bouton « tester la clé »
}

interface TranscribeOpts {
  model: string;
  language?: string;
  diarize: boolean;  // ignoré si !supportsDiarization
}

interface TranscriptionResult {
  text: string;
  segments?: Segment[];  // présents si diarize et supporté
}

interface Segment { text: string; start: number; end: number; speaker_id?: string }
```

### 5.2 Différences diarization

- **MistralProvider** : `supportsDiarization = true`. Si `diarize: true`, appelle Voxtral avec `diarize=true, timestamp_granularities=["segment"]` → renvoie `segments[].speaker_id`. Si `diarize: false`, transcript plat.
- **OpenAIProvider** : `supportsDiarization = false`. `diarize` ignoré, transcript plat. Documenté dans l'UI (toggle désactivé quand OpenAI sélectionné).
- **CustomProvider** : `supportsDiarization` configurable (par défaut `false`).
- **MockProvider** : déterministe, renvoie des segments en cache pour les tests.

### 5.3 Modèles & endpoint

- Dropdown presets : `voxtral-mini-latest` (Mistral), `whisper-1` + `gpt-4o-transcribe` (OpenAI).
- Champs custom : `endpoint` + `model` (provider Custom, ou pour surcharger un preset).
- Clé API par provider, `chrome.storage.local`, jamais loggée.

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

## 7. Config (`chrome.storage.local`)

```ts
interface Config {
  provider: 'mistral' | 'openai' | 'custom';
  model: string;
  customEndpoint?: string;
  apiKeys: { mistral?: string; openai?: string; custom?: string };
  diarize: boolean;
  downloadAudio: boolean;   // défaut false
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
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background/service-worker.js", "type": "module" },
  "action": { "default_title": "OpenMeetRec" },
  "options_page": "ui/options.html",
  "web_accessible_resources": [
    { "resources": ["offscreen/offscreen.html", "ui/record.html"], "matches": ["<all_urls>"] }
  ]
  // pas de content_scripts en MVP
}
```

Clic sur l'action → ouvre `ui/record.html` dans un onglet (via `chrome.tabs.create`).

## 9. Permissions audit

Document `docs/permissions-audit.md` justifie chaque permission :
- `tabCapture` : audio de l'onglet visio courant.
- `offscreen` : tenir le recorder hors du service worker.
- `storage` : config + clés API (locales).
- `downloads` : export markdown + audio.
- `activeTab` : onglet courant pour le record.
- `host_permissions <all_urls>` : capture sur n'importe quelle plateforme de visio ; requête API au provider choisi.

Aucune télémétrie. CSP restrictive.

## 10. Auto-contrôle (tests)

> Réponse à : « Playwright aide-t-il pour une extension ? »

**Oui, de façon ciblée**, combiné à des tests unitaires qui font l'essentiel.

### 10.1 Niveau 1 — Unitaires (Vitest, sans navigateur)

Le plus rentable, car la logique fragile est **pure** :
- `audio/chunking.ts` : split + overlap, bornes, cas < seuil, cas exactement au seuil (ports des cas de `chunking.py`).
- `audio/merge.ts` : `merge_segments` crossfade, `merge_texts` concat, offset, 1 chunk / N chunks.
- `config/config.ts` : résolution provider/modèle, defaults.
- `capture/detect.ts` : feature detection sur mocks de `chrome`.
- `providers/mock.ts` : déterministe.
- `shared/format.ts` : génération frontmatter + blockquote (avec/sans diarization).

**Règle d'architecture : ces modules n'importent jamais `chrome`/`browser`** → testables en ms.

### 10.2 Niveau 2 — Pipeline audio (Vitest + Web Audio polyfill, ou Playwright)

- Fixture `tests/fixtures/audio/30s.webm`.
- Décodage + chunking + re-encode réels.
- Assert : N chunks, durée cumulée == source + overlap, opus lisible.
- Fallback : exécuter dans Playwright (vrai Web Audio) si la polyfill Node est limitée.

### 10.3 Niveau 3 — Intégration (Playwright headful, extension unpacked)

Playwright charge une extension unpacked (Chromium headful sous xvfb, flags `--load-extension`) :

- `e2e/record.spec.ts` : ouvre `record.html`, Start, joue `meeting-page.html` (un `<audio>` opus), Stop, assert un `.md` téléchargé avec frontmatter + blockquote.
- `e2e/capture-tabcapture.spec.ts` : `tabCapture` sans picker → automatisable, assert `.webm` non vide.
- `e2e/providers.spec.ts` : provider **mock** → transcript déterministe, exports txt/json présents.
- `e2e/options.spec.ts` : config persistée, bouton « tester la clé » mocké, clé pas loggée.

**Provider mock obligatoire** : pas de réseau, pas de clé API en CI.

### 10.4 Page fixture WebRTC (`tests/fixtures/meeting-page.html`)

Page factice qui :
- crée un `AudioContext` + `OscillatorNode` (sine 440 Hz) → `MediaStreamDestination` ;
- monte un `RTCPeerConnection` loopback transportant la piste ;
- override `getUserMedia` pour renvoyer la sine-wave.

Permet de tester la capture **sans vraie visio, sans micro, sans réseau**, déterministe. Réutilisable pour le path Firefox plus tard.

### 10.5 Ce que Playwright ne couvre pas

| Cas | Contournement |
|---|---|
| `getDisplayMedia` (picker système) | Non utilisé en MVP (`tabCapture` à la place) |
| Extension Firefox | Non supporté par Playwright → `firefox-mcp` exploratoire, post-MVP |
| Vrai micro matériel | Override `getUserMedia` en MAIN world de test (sine-wave) |

### 10.6 CI

- `npm test` : Vitest (unitaires) → rapide.
- `npm run test:e2e` : Playwright headful sous xvfb (déjà dispo via le skill playwright-cli).

### 10.7 Synthèse

- **L'essentiel de la robustesse vient des tests unitaires sur la logique pure** (chunking/merge/config/format/providers) — c'est là qu'on investit en premier, fully automatisable.
- **Playwright complète** pour la plomberie extension (popup/options/downloads/tabCapture) avec une page fixture WebRTC.
- **Firefox** sera couvert plus tard via `firefox-mcp` (exploratoire) puis geckodriver si on automatise.

L'architecture est donc **motivée par la testabilité** : capture abstraite, provider mock, logique pure isolée, page fixture. Ce sont des décisions de conception, pas une rustine.
