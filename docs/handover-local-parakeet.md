# Handover — Test inférence locale Parakeet (WebGPU, in-browser)

> Objectif : permettre à un utilisateur d'OpenMeetRec de transcrire **sans clé API payante**,
> avec un modèle qui tourne **dans le navigateur** (WebGPU). Pas de serveur local (Coro etc. : écarté).
> Stratégie : test rapide et simple. Si ça marche → on propose la solution. Sinon → on abandonne.

## 1. État des recherches (déjà fait)

### Verdict modèle : Parakeet, pas Nemotron

| | Parakeet TDT 0.6B v3 | Nemotron ASR |
|---|---|---|
| Package browser | **`parakeet.js`** (npm, maintenu) | aucun pipeline natif (boucle RNNT à écrire à la main) |
| Taille | **409 Mo** (int4/int4 hybride, ONNX) | ~750 Mo |
| API | `fromHub()` → `transcribe(pcm, 16000)` | export browser **cache-free** (perd le streaming) |
| Timestamps | **natifs** (nécessaires au merge de chunks) | ❌ aucun |
| Licence | **CC-BY-4.0** | OpenMDW-1.1 (plus restrictive) |
| WER | ~6.3 %, FR inclus | — |
| Démo live | https://parakeetweb.olicorne.org | projet démo : khawjaahmad/nemotron-asr-webgpu |

NB : « Nemotron-H 4B » est un LLM de texte (pas ASR) — hors scope MVP (transcription seule).
Aucun des deux modèles ne fait la diarization — elle reste assurée par les providers distants (Mistral/OpenAI).

### Architecture visée dans l'extension (pour après le test)

- Le pipeline (`runPipeline`) tourne déjà dans l'**offscreen document** → c'est l'hôte naturel de l'inférence
  (seul contexte MV3 vivant toute la session avec DOM + WebGPU).
- Inférence dans un **Web Worker** lancé par l'offscreen (ne pas bloquer le mix Web Audio).
- Ruse pour ne presque rien changer au code : le `CustomProvider` existant accepte un `fetchImpl` injecté
  (`src/providers/factory.ts`). Convention `customEndpoint = "local:parakeet"` → on injecte un faux `fetch`
  qui route le Blob audio vers l'offscreen via `chrome.runtime` messaging et renvoie une `Response` JSON
  compatible OpenAI (`{text, segments}`) → `http.ts`/`parse.ts`/`merge.ts`/`pipeline.ts` **intacts**.
- Contraintes MV3 à traiter plus tard : COOP/COEP au manifest, CSP `wasm-unsafe-eval`,
  assets ORT (`.wasm`/`.mjs`) en `web_accessible_resources` (piège connu : onnx/onnx#6581),
  `host_permissions huggingface.co` ou self-host du modèle.

### Blocage rencontré sur le VPS

Le VPS n'a **aucun GPU compatible WebGPU** (Cirrus Logic GD 5446, pas de Vulkan) → `navigator.gpu` y est
`undefined`. Le test ne peut se faire que sur une machine avec vrai GPU → **d'où ce handover sur macOS**.

## 2. Ce qu'on teste sur macOS (spike Phase 0)

But unique : **prouver que Parakeet charge et transcrit en WebGPU dans Chrome**, et mesurer le temps.
C'est la seule phase qui peut faire échouer le plan ; si elle passe, le reste est de l'assemblage.

### Prérequis

- Chrome récent (WebGPU actif par défaut depuis ~Chrome 121 sur macOS ; vérifier `chrome://gpu`).
- Une connexion internet pour le premier téléchargement du modèle (409 Mo depuis HuggingFace).
- Une machine à distance GPU n'est pas nécessaire : tout tourne dans le navigateur.

### Étapes du test

1. **Check WebGPU brut** (5 min) : ouvrir la console sur n'importe quelle page et vérifier :
   ```js
   const adapter = await navigator.gpu.requestAdapter();
   console.log(adapter?.info ?? "PAS DE WEBGPU");
   ```
2. **Page de test standalone** (~30 min) : un `index.html` + module JS qui :
   - `npm i parakeet.js onnxruntime-web` (dans un dossier jetable, pas dans le repo),
   - charge le modèle via `parakeet.js` `fromHub()` (modèle : parakeet-tdt-0.6b-v3 int4, encoder WebGPU / decoder WASM),
   - décode un fichier audio court en PCM 16 kHz mono,
   - appelle `transcribe(pcm, 16000)` et affiche `{text, segments}` + timing.
   - ⚠️ Servir via `localhost` (ex. `npx serve` ou `python3 -m http.server`) : pas en `file://`
     (workers/modules bloqués). Pas besoin de HTTPS sur localhost.
3. **Mesures à relever** :
   - temps de chargement du modèle (une seule fois, + vérifier qu'il est caché ensuite),
   - temps de transcription d'un chunk de 30–60 s (comparer à la durée réelle → ratio real-time),
   - qualité du texte FR et présence des timestamps (`segments[].start/end`),
   - refaire une passe en **fallback WASM** (forcer le backend) pour connaître le coût « pas de GPU ».
4. **Optionnel** : tester avec un vrai chunk de visio (ex. généré via la fixture
   `tests/integration/fixtures/meeting-page.html` du repo) pour valider le décodage webm→PCM.

### Critères de go / no-go

| Résultat | Décision |
|---|---|
| Transcription correcte + timestamps, chunk 60 s traité en < ~30 s | **GO** → intégrer en `local:parakeet` derrière le `CustomProvider` (plan §1) |
| Ça marche mais lent en WebGPU | Re-tester WASM ; si WASM lent aussi → probable abandon |
| Le modèle ne charge pas / WebGPU plante dans Chrome | **NO-GO** → abandon in-browser, on en reste là (ou on rouvre la réflexion plus tard) |

## 3. Si GO : le plan d'implémentation (résumé, ~3-4 j)

| Phase | Contenu | Durée |
|---|---|---|
| 1 — Faux fetch | `localParakeetFetch.ts` (~40 l.) + aiguillage `local:` dans `factory.ts` (~10 l.) | 0,5 j |
| 2 — Manifest/build | COOP/COEP + CSP `wasm-unsafe-eval` + assets ORT en WAR | 0,5 j |
| 3 — Worker offscreen | `parakeet.worker.ts` (modèle en vie entre chunks) + routeur `LOCAL_TRANSCRIBE` | 1 j |
| 4 — Config/UI/docs | validation `local:` (relâcher HTTPS pour `local:`, clé factice), permissions-audit | 0,5 j |

Cœur métier non touché : `http.ts`, `custom.ts`, `parse.ts`, `merge.ts`, `pipeline.ts`.
Validation à donner avant : `npm i parakeet.js onnxruntime-web` (règle AGENTS : pas de dépendance sans justification).
Hébergement modèle à trancher : `fromHub` (HF) pour le spike, self-host (Caddy/Cloudron) en production.

## 4. Notes

- ⚠️ Les docs de la session précédente (`docs/feasibility-local-webgpu.md`, `docs/plan-local-parakeet.md`)
  **ont été perdus** (worktree réinitialisé avant commit) — ce fichier réintègre l'essentiel.
- Référence utile : démo qui tourne à https://parakeetweb.olicorne.org ; piège ORT+MV3 : onnx/onnx#6581.
- Après le test : mettre à jour `CHANGELOG.md` si la fonctionnalité entre, et `docs/permissions-audit.md`
  pour les permissions ajoutées (`huggingface.co`, COOP/COEP…).
