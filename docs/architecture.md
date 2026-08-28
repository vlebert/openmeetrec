# OpenMeetRec — Architecture

> Version 0.1. Architecture cible pour le MVP. À valider avant le développement.

## 1. Vue d'ensemble

Une base de code TypeScript, deux runtime extensions (Chromium MV3, Firefox MV3), une **couche d'abstraction de capture** qui sélectionne la stratégie selon le navigateur, et un **pipeline audio→texte** porté de `supervoxtral`.

```
┌──────────────────────────────────────────────────────────────┐
│  UI : popup.html / options.html                               │
│  (boutons, meters, statut, config)                            │
└───────────────┬──────────────────────────────────────────────┘
                │ messaging (chrome.runtime)
┌───────────────▼──────────────────────────────────────────────┐
│  Background service worker (MV3)                              │
│  - orchestre le record (start/stop)                           │
│  - choisit la CaptureStrategy (feature detection)             │
│  - crée l'offscreen document (Chromium)                       │
│  - gère config (chrome.storage) + clé API                     │
└───────┬───────────────┬──────────────────────────────────────┘
        │               │
   ┌────▼─────┐   ┌─────▼──────────────────────────────────────┐
   │ Offscreen │   │ Content scripts                            │
   │ document  │   │ - ISOLATED world : pont de messages        │
   │ (Chromium)│   │ - MAIN world (Firefox) : hooks WebRTC       │
   │ recording │   └─────┬──────────────────────────────────────┘
   │ + encode  │         │ MediaStream (audio) via messaging
   └─────┬────┘         │  (ou transfert via port)
         │               │
         ▼               ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ Audio pipeline (TS pur + Web Audio + WebCodecs)             │
   │ resample → chunk (overlap) → encode opus → storage (OPFS)  │
   └───────────────┬─────────────────────────────────────────────┘
                   │
   ┌───────────────▼─────────────────────────────────────────────┐
   │ Provider abstraction                                        │
   │ - MistralProvider (Voxtral + chat)  - MockProvider (tests)  │
   │ - (post-MVP) WhisperLocalProvider, OllamaProvider           │
   └───────────────┬─────────────────────────────────────────────┘
                   │
   ┌───────────────▼─────────────────────────────────────────────┐
   │ Merge (crossfade/concat) → format → export (txt/json/md)     │
   └───────────────────────────────────────────────────────────────┘
```

## 2. Structure de fichiers (cible)

```
openmeetrec/
├── docs/
│   ├── PRD.md
│   ├── architecture.md
│   └── permissions-audit.md        # justification de chaque permission
├── src/
│   ├── manifest.json               # base, généré pour Chromium/Firefox
│   ├── background/
│   │   ├── service-worker.ts        # orchestration, capture strategy picker
│   │   └── messaging.ts
│   ├── offscreen/
│   │   ├── offscreen.html
│   │   └── offscreen.ts             # tient le MediaRecorder (Chromium)
│   ├── content/
│   │   ├── isolated.ts              # pont messages (ISOLATED world)
│   │   └── webrtc-hook.ts           # injecté en MAIN world (Firefox)
│   ├── capture/
│   │   ├── strategy.ts              # interface CaptureStrategy
│   │   ├── tabCaptureStrategy.ts    # Chromium
│   │   ├── webrtcStrategy.ts        # Firefox / fallback
│   │   └── detect.ts                # feature detection du navigateur
│   ├── audio/
│   │   ├── resample.ts              # Web Audio → 16k mono
│   │   ├── recorder.ts              # wrapper MediaRecorder
│   │   ├── chunking.ts              # split + overlap (port de chunking.py)
│   │   ├── merge.ts                 # merge_segments / merge_texts (port)
│   │   └── encode.ts                # WebCodecs AudioEncoder (opus)
│   ├── pipeline/
│   │   ├── pipeline.ts              # record→convert→chunk→transcribe→merge→transform
│   │   └── concurrency.ts          # sémaphore (Promise.all limité)
│   ├── providers/
│   │   ├── base.ts                  # Provider interface
│   │   ├── mistral.ts               # port de providers/mistral.py
│   │   └── mock.ts                  # réponses en cache pour tests
│   ├── storage/
│   │   ├── opfs.ts                  # OPFS read/write
│   │   └── export.ts                # download txt/json/md/webm
│   ├── config/
│   │   └── config.ts                # schéma chrome.storage (miroir config.toml)
│   ├── ui/
│   │   ├── popup.html / popup.ts
│   │   └── options.html / options.ts
│   └── shared/
│       ├── types.ts                 # TranscriptionSegment, ChunkInfo, etc.
│       └── polyfill.ts              # webextension-polyfill wrapper
├── tests/
│   ├── unit/                        # Vitest — chunking, merge, config, detect
│   ├── integration/                 # Playwright — extension chargée
│   └── fixtures/
│       ├── meeting-page.html        # page visio factice (WebRTC + sine wave)
│       └── audio/                  # webm/opus d'exemple
├── scripts/
│   ├── build.mjs                    # build Chromium + Firefox variants
│   └── pack.mjs
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## 3. Stratégies de capture

### 3.1 Interface commune

```ts
interface CaptureStrategy {
  readonly id: 'tabcapture' | 'webrtc';
  start(tabId: number): Promise<MediaStream>; // audio distant
  stop(): void;
}
```

Le micro est géré à part via `getUserMedia` (commun aux deux stratégies), puis mixé.

### 3.2 `tabCaptureStrategy` (Chromium)

- `chrome.tabCapture.getMediaStreamId({ targetTabId })` dans le service worker après user gesture (clic popup).
- Le streamId est passé à l'**offscreen document** qui appelle `navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', streamId } } })`.
- L'offscreen document tient le `MediaRecorder` (le service worker ne peut pas tenir un flux).
- Pas de picker de partage (contrairement à `getDisplayMedia`) → automatisable.

### 3.3 `webrtcStrategy` (Firefox / fallback)

- Content script injecté en **MAIN world** (`world: "MAIN"`, FF 128+) **avant** `document_start` du mieux possible.
- Monkey-patch :
  - `navigator.mediaDevices.getUserMedia` → capture le flux micro sortant.
  - `RTCPeerConnection` (constructeur + prototype) → hook `ontrack`, `addEventListener('track')`, `addTrack`, `getReceivers()` → capture les pistes audio entrantes.
- Attache chaque `MediaStreamTrack` audio à un `MediaStreamAudioSourceNode` dans un `AudioContext` partagé, mixe vers une `MediaStreamAudioDestinationNode`.
- Comme le MAIN world n'a pas accès aux APIs extension, le flux enregistré est **consommé localement** (MediaRecorder dans le MAIN world) puis les chunks/blobs sont renvoyés au content script ISOLATED via `postMessage` (les `Blob` se sérialisent, contrairement aux `MediaStream`).

### 3.4 Détection

```ts
function detectStrategy(): CaptureStrategy {
  if (typeof chrome !== 'undefined' && chrome.tabCapture) return new TabCaptureStrategy();
  if (supportsMainWorld()) return new WebRTCStrategy(); // Firefox 128+
  throw new Error('Aucune stratégie de capture supportée sur ce navigateur.');
}
```

## 4. Pipeline audio (port de supervoxtral)

Mapping direct depuis `supervoxtral/svx/core/` :

| supervoxtral (Python) | OpenMeetRec (TS) | Notes |
|---|---|---|
| `audio.convert_audio` (ffmpeg → mp3/opus) | `audio/resample.ts` + `audio/recorder.ts` | MediaRecorder produit déjà webm/opus ; resample via Web Audio |
| `chunking.split_audio` (soundfile/ffmpeg) | `audio/chunking.ts` | decodeAudioData → slice Float32Array avec overlap → re-encode |
| `chunking.merge_segments` (crossfade) | `audio/merge.ts` | port TS pur, logique identique |
| `chunking.merge_texts` (concat) | `audio/merge.ts` | port TS pur |
| `pipeline._transcribe_chunked` (ThreadPoolExecutor) | `pipeline/concurrency.ts` | sémaphore Promise.all(4) |
| `pipeline.process` (2 étapes) | `pipeline/pipeline.ts` | transcribe → chat(prompt) |
| `providers/mistral.MistralProvider` | `providers/mistral.ts` | fetch à l'API Mistral |
| `meeting_audio.record_dual_wav` | mix dans `offscreen.ts` / `webrtc-hook.ts` | deux sources → un mix mono |

### 4.1 Chunking — détail

**Stratégie A (MVP, fidèle au Python) : record-then-slice**

1. Enregistrement complet → blob webm/opus (ou accumulation dans OPFS si long).
2. `arrayBuffer = await blob.arrayBuffer()` → `AudioContext.decodeAudioData` → `AudioBuffer` (PCM float32, 16 kHz mono après resample).
3. Slicing : chunks de `chunkDuration` (300s) avec `overlap` (30s), `step = chunkDuration - overlap`. Copie sample-accurate de `channelData`.
4. Re-encodage de chaque chunk en opus/webm :
   - **WebCodecs `AudioEncoder`** (codec `opus`) si disponible — préféré, output stream.
   - Fallback : `MediaRecorder` sur un `MediaStream` reconstruit via `AudioBufferSourceNode → MediaStreamAudioDestinationNode`.
5. `ChunkInfo { index, start, end }` porté tel quel.

**Stratégie B (post-MVP, live) : rotation de MediaRecorder** — pas de slicing a posteriori, chunks produits pendant le record. Overlap via ringbuffer des N dernières secondes réinjecté. Documenté mais hors MVP.

## 5. Config

Schéma `chrome.storage.local` miroir de `config.toml` de supervoxtral :

```ts
interface Config {
  defaults: {
    provider: 'mistral' | 'mock';
    model: string;            // 'voxtral-mini-latest'
    chatModel: string;        // 'mistral-small-latest'
    format: 'opus' | 'mp3';
    sampleRate: number;       // 16000
    channels: 1 | 2;
    language: string | null;
    diarize: boolean;
    chunkDuration: number;    // 300
    chunkOverlap: number;     // 30
    keepAudio: boolean;
    copyToClipboard: boolean;
    captureStrategy: 'auto' | 'tabcapture' | 'webrtc';
    contextBias: string[];
  };
  providers: { mistral: { apiKey: string } };
  prompts: Record<string, string>; // { default: "...", summary: "...", mail: "..." }
}
```

Clé API **jamais** dans `storage.sync`, jamais loggée.

## 6. Manifest (cross-browser)

Un `manifest.json` source, buildé en deux variantes :

- **Chromium** : MV3, `permissions: ["activeTab","tabCapture","offscreen","storage","downloads"]`, `host_permissions: ["<all_urls>"]`, content script `webrtc-hook` non requis.
- **Firefox** : MV3, `browser_specific_settings.gecko.id`, `permissions: ["storage","downloads","scripting"]`, content scripts avec `world: "MAIN"`, pas de `tabCapture`/`offscreen`.

Build via `scripts/build.mjs` (paramètre `--target=chrome|firefox`). Vite pour le bundling.

## 7. Sécurité & audit des permissions

Document `docs/permissions-audit.md` justifie chaque permission :
- `tabCapture` : capture audio de l'onglet de visio (Chromium only).
- `offscreen` : tenir le recorder hors du service worker (Chromium only).
- `storage` : config + clé API (locale).
- `downloads` : export fichiers.
- `scripting` + `host_permissions` : injection MAIN world (Firefox).
- `activeTab` : onglet courant pour le record.

Permissions marquées `optional` quand possible. Aucune télémétrie. `content_security_policy` restrictive.

## 8. Build & distribution

- Vite + TypeScript, bundling par cible.
- `npm run build:chrome`, `npm run build:firefox`.
- Tests : `npm test` (Vitest), `npm run test:e2e` (Playwright).
- Distribution : chargement unpacked pour le dev ; package `.zip`/`.xpi` pour release. Store (Chrome Web Store / AMO) dans un second temps après audit.

---

## 9. Stratégie d'auto-contrôle (tests)

> C'est la réponse à la question : « comment m'auto-contrôler sachant que tu as Playwright, mais est-ce utile pour une extension ? »

**Oui, Playwright est utile — mais de façon ciblée, et pas pour tout.** On combine plusieurs niveaux.

### 9.1 Ce que Playwright **peut** faire pour une extension

Playwright (Chromium) supporte le chargement d'une extension **unpacked** via `launchPersistentContext` avec les flags `--disable-extensions-except=<dir>` et `--load-extension=<dir>` — **en mode headful uniquement** (sous xvfb sur le serveur). Concrètement on peut :

- Ouvrir le **popup** de l'extension et cliquer les boutons (record/stop) → déclencher le `tabCapture` après le gesture utilisateur (pas de picker de partage → automatisable).
- Ouvrir une **page de visio factice** (`tests/fixtures/meeting-page.html`) qui crée un `RTCPeerConnection` avec une piste audio sine-wave, et vérifier que l'extension la capture.
- Naviguer dans la page **options**, saisir la clé API mock, changer la config, et vérifier la persistance.
- Inspecter les **downloads** produits (`.webm`, `.txt`, `.json`) et les assertions sur leur contenu.
- Lire les **logs** du service worker / offscreen via CDP.

### 9.2 Ce que Playwright **ne sait pas** faire (ou mal)

| Cas | Pourquoi | Contournement |
|---|---|---|
| `getDisplayMedia` (audio système) | Affiche un picker natif non pilotable | On évite : MVP n'utilise pas getDisplayMedia. Chrome flag `--auto-select-desktop-capture-source` si besoin ponctuel. |
| Charger une extension dans **Firefox** | Playwright ne supporte pas le chargement d'extensions Firefox | **firefox-mcp** (Firefox réel en VNC) pour tests exploratoires manuels ; ou geckodriver + `--marionette` pour automatiser |
| Captures nécessitant un vrai micro matériel | Pas d'audio réel | Page fixture qui injecte un `AudioContext` sine-wave comme `getUserMedia` fake (via override en MAIN world de test) |
| Permissions `getUserMedia` | Dialogues | `context.grantPermissions(['microphone'])` côté Playwright |

### 9.3 Stratégie de tests en 4 niveaux

**Niveau 1 — Tests unitaires (Vitest, sans navigateur).** Le plus important et le plus rentable, parce que la logique fragile est **pure** :

- `audio/chunking.ts` : split avec overlap, bornes, cas < seuil, cas exactement au seuil. (Port direct des cas couverts par `chunking.py`.)
- `audio/merge.ts` : `merge_segments` crossfade, `merge_texts` concat, ajustement d'offset, cas 1 chunk / N chunks. → **port TS pur, testable sans Web Audio.**
- `config/config.ts` : résolution des prompts, priorités, defaults.
- `capture/detect.ts` : feature detection sur des mocks de `chrome` / `browser`.
- `providers/mock.ts` : déterministe, renvoie des segments en cache.

Ces tests couvrent ~70% de la logique critique et tournent en ms, sans xvfb.

**Niveau 2 — Tests « audio pipeline » (Vitest + jsdom/Node WebCodecs).** Le chunking+encode réel :

- Fixture `tests/fixtures/audio/30s.webm` (opus).
- Décodage via `AudioContext` (polyfill `web-audio-api` en Node, ou run dans Playwright headful si la polyfill est trop limitée).
- Assert : N chunks produits, durée cumulée == durée source + overlap, opus lisible.
- Fallback : exécuter ces tests dans Playwright (qui a un vrai Web Audio) plutôt qu'en Node, si la polyfill Node est trop limitée.

**Niveau 3 — Tests d'intégration (Playwright headful, extension unpacked).**

- `e2e/capture-tabcapture.spec.ts` (Chromium) : charge l'extension, ouvre `meeting-page.html` (un `<audio>` qui joue un opus), clique record, attend N secondes, stop, assert un `.webm` téléchargé non vide + décodable.
- `e2e/capture-webrtc.spec.ts` (Chromium et Firefox-idéalement) : `meeting-page.html` monte un `RTCPeerConnection` loopback avec une sine-wave track, l'extension la capture via le hook MAIN world, assert transcript mock.
- `e2e/pipeline.spec.ts` : record court → provider **mock** → assert transcript + résumé mock produits, exports txt/json présents.
- `e2e/options.spec.ts` : config persistée, clé API pas loggée.
- **Provider mock obligatoire** pour que ces tests soient déterministes, hors réseau, sans clé API.

**Niveau 4 — Tests exploratoires Firefox (firefox-mcp).** Firefox réel en VNC via le wrapper `firefox-mcp` :

- Charger l'extension temporairement (`about:debugging`).
- Naviguer sur une vraie page de test, valider visuellement le popup, meters, capture.
- Non automatisable strictement, mais couvre le path Firefox que Playwright ne peut pas.
- Documenté comme runbook dans `docs/testing-firefox.md`.

### 9.4 Page fixture WebRTC (`tests/fixtures/meeting-page.html`)

C'est la clé pour rendre les e2e **déterministes et sans vraie visio** :

- Crée un `AudioContext` avec un `OscillatorNode` (sine 440 Hz) → `MediaStreamDestination` → piste audio factice.
- Monte un `RTCPeerConnection` en loopback (offer/answer entre deux peers dans la même page) qui transporte cette piste.
- Override `navigator.mediaDevices.getUserMedia` pour renvoyer la sine-wave (simule le micro).
- Permet de tester le hook WebRTC **sans réseau, sans microphone, sans plateforme réelle**.

### 9.5 CI sur le serveur

- `npm test` (Vitest) → rapide, vert en CI.
- `npm run test:e2e` → Playwright **headful sous xvfb** (déjà dispo sur le VPS via le skill playwright-cli).
- Firefox e2e : manuel / runbook (ou geckodriver si on automatise plus tard).

### 9.6 En résumé sur ta question

- **Playwright aide réellement** pour l'extension : charger unpacked, piloter popup/options, et surtout piloter une **page fixture WebRTC** pour valider la capture sans vraie visio. La capture `tabCapture` est automatisable (pas de picker). La capture WebRTC est **idéale** pour l'auto-contrôle car pure JS, sans permission native.
- **Playwright ne couvre pas Firefox** (chargement d'extension non supporté côté Firefox) → on complète avec `firefox-mcp` (exploratoire) et/ou geckodriver.
- **L'essentiel de la robustesse vient des tests unitaires** sur la logique pure (chunking/merge/config) — c'est là qu'il faut investir en premier, parce que c'est la partie fragile et fully automatisable.

L'architecture est donc conçue pour la testabilité : **stratégie de capture abstraite**, **provider mock**, **page fixture WebRTC**, **logique pure isolée** du DOM/navigateur. Ce sont des décisions d'architecture motivées par l'auto-contrôle, pas une rustine ajoutée à la fin.
