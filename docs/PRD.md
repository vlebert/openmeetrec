# OpenMeetRec — PRD (Product Requirements Document)

> Version 0.1 — en cours de révision. Toute la portée est ouverte à discussion avant le développement.

## 1. Vision

Une extension de navigateur **open source**, **auditable** et **privacy-first** qui :

1. Enregistre l'audio d'une vidéoconférence web (micro local + voix des participants distants), **quelle que soit la plateforme** (Google Meet, Zoom web, Microsoft Teams web, Webex, Jitsi, etc.), dans un onglet du navigateur.
2. Fonctionne sur **Chromium ET Firefox** à partir d'une même base de code.
3. Enregistre **localement par défaut**, sans bot visible, sans envoi audio non sollicité vers le cloud.
4. Transforme l'audio en texte via un **pipeline LLM en 2 étapes** (transcription → transformation) inspiré de `supervoxtral`, avec chunking des longues réunions.
5. Laisse l'utilisateur choisir le niveau de confidentialité : transcription **locale** (à terme) ou via **API** (Mistral Voxtral, etc.).

## 2. Problèmes que l'on résout

| Problème actuel | Réponse d'OpenMeetRec |
|---|---|
| Extensions de recording fermées et opaques (« Record Meetings ») | Code OSS, MIT, chaque permission justifiée dans un audit public |
| Pas d'extension de recording audio sur Firefox (tabCapture/getDisplayMedia manquants) | Stratégie fallback par **interception WebRTC en MAIN world** (FF 128+) |
| Pas d'extension cross-browser réelle | Une base de code, deux stratégies de capture auto-sélectionnées |
| Outils à bot visible (Otter/Fathom/Fireflies) → gênants en réunion | Aucun bot, capture discrète côté client |
| Audio envoyé au cloud par défaut | Local par défaut ; API opt-in, clé gérée par l'utilisateur |
| Visios dans apps desktop (Zoom/Teams native) non couvertes par une extension | Hors périmètre assumé (le navigateur est la seule surface réaliste) |

## 3. Personas

- **Dominique, freelance en réunion client** : veut une transcription propre + résumé d'actions, sans bot visible, sans diffuser l'audio client à un tiers.
- **Équipe soucieuse du RGPD** : veut un outil auditable, déployable, où l'audio reste sur le poste.
- **Développeur local-first** : veut brancher Whisper.cpp / Ollama en local, sans dépendre d'une API.

## 4. Périmètre

### 4.1 Dans le périmètre (MVP → v1)

- Capture **audio uniquement** (pas de vidéo) d'un onglet de visio.
- Deux sources combinées : **micro local** + **participants distants**.
- Cross-browser : Chromium (Chrome/Edge/Brave/Opera) et Firefox (128+).
- Enregistrement local (OPFS pour les longs fichiers, téléchargement sinon).
- Conversion/resampling vers un format adapté à la transcription (Opus, 16 kHz mono optionnel).
- **Chunking** des longs enregistrements avec overlap, transcription parallèle, merge crossfade.
- Pipeline 2 étapes : transcription (Voxtral/Mistral API) + transformation (LLM chat + prompts configurables).
- Diarization (attribution des speakers) quand le provider le supporte.
- Export : transcript texte, JSON (segments), fichier audio.
- UI : popup one-click, meters de niveau, statut, options (clé API, prompts, format, chunks).
- Document d'**audit des permissions** (chaque permission justifiée).

### 4.2 Hors périmètre (MVP)

- Enregistrement **vidéo**.
- Bot cloud rejoignant la réunion.
- Apps desktop de visio (Zoom/Teams native) — couvertes seulement par le path « driver audio virtuel », hors extension.
- Capture de l'**audio système complet** (hors onglet) sur macOS/Linux (limitation OS) — non couverte sauf fallback driver virtuel documenté.
- Mobile.
- Temps réel / streaming live (considéré après MVP).

### 4.3 Plus tard (post-MVP)

- Transcription **100% locale** (Whisper.cpp WASM, Ollama) comme provider alternatif.
- Mode « live » : transcription en streaming pendant la réunion (chunking en temps réel, stratégie B).
- Diarization améliorée + étiquetage des speakers persistant.
- Stockage cloud optionnel (Drive, etc.) chiffré côté client.
- Export formats (Markdown, PDF, intégration Notion/Obsidian).
- Vidéo (option).

## 5. Exigences fonctionnelles

### 5.1 Capture

| ID | Exigence |
|---|---|
| F-CAP-01 | Démarrer/arrêter l'enregistrement en un clic depuis le popup ou un raccourci |
| F-CAP-02 | Capturer le micro local via `getUserMedia` |
| F-CAP-03 | Capturer l'audio des participants distants via **`chrome.tabCapture`** sur Chromium |
| F-CAP-04 | Capturer l'audio distant via **interception WebRTC en MAIN world** sur Firefox (fallback Chromium possible) |
| F-CAP-05 | Sélectionner automatiquement la stratégie selon le navigateur (feature detection) |
| F-CAP-06 | Permettre à l'utilisateur de forcer une stratégie (options avancées) |
| F-CAP-07 | Mixer micro + distant en un flux mono (option : garder 2 pistes séparées pour la diarization) |
| F-CAP-08 | Aucune capture tant que l'utilisateur n'a pas cliqué (pas de capture passive) |
| F-CAP-09 | Gérer la perte d'onglet / navigation : arrêt propre, fichier sauvegardé |

### 5.2 Audio / format

| ID | Exigence |
|---|---|
| F-AUD-01 | Sortie **audio uniquement** (pas de piste vidéo) |
| F-AUD-02 | Encodage **Opus dans WebM** via `MediaRecorder` (natif, pas de ffmpeg) |
| F-AUD-03 | Resampling optionnel à **16 kHz mono** via Web Audio API (optimal Voxtral/Whisper) |
| F-AUD-04 | Skip conversion si le flux sortant est déjà au format cible |
| F-AUD-05 | Niveau de qualité/bitrate configurable |

### 5.3 Chunking & merge

| ID | Exigence |
|---|---|
| F-CHK-01 | Détecter la durée totale (temps écoulé pendant le record ou `AudioBuffer.duration`) |
| F-CHK-02 | Si > seuil (défaut 5 min), découper en chunks de 300s avec overlap 30s |
| F-CHK-03 | Slicing **sample-accurate** (stratégie A : decodeAudioData + WebCodecs/MediaRecorder) |
| F-CHK-04 | Option stratégie B : rotation de `MediaRecorder` en temps réel (post-MVP) |
| F-CHK-05 | Transcription **parallèle** des chunks (concurrence limitée, ex. 4) |
| F-CHK-06 | Merge **crossfade** au milieu de l'overlap (segments) ou concaténation + nettoyage LLM (texte) |
| F-CHK-07 | Ajustement des timestamps à l'absolu (offset par chunk) |

### 5.4 Pipeline LLM

| ID | Exigence |
|---|---|
| F-LLM-01 | Étape 1 : transcription via provider (Voxtral/Mistral API en MVP) |
| F-LLM-02 | Étape 2 : transformation via LLM chat + prompt configuré |
| F-LLM-03 | Mode **transcribe-only** (étape 1 seule) |
| F-LLM-04 | Diarization activable (option du provider) |
| F-LLM-05 | Prompts multiples configurables (default, résumé, action items, mail…) |
| F-LLM-06 | Provider **mock** intégré pour les tests (réponses en cache) |
| F-LLM-07 | Clé API stockée dans `chrome.storage`, jamais loggée |
| F-LLM-08 | Gestion d'erreur API (rate limit, timeout, retry avec backoff) |

### 5.5 Stockage / export

| ID | Exigence |
|---|---|
| F-STO-01 | Fichier audio stocké en **OPFS** pour les longs enregistrements (anti-perte) |
| F-STO-02 | Téléchargement `.webm` à la demande |
| F-STO-03 | Export transcript `.txt`, `.json` (segments), `.md` |
| F-STO-04 | Politique de rétention configurable (conserver audio / supprimer après transcription) |
| F-STO-05 | Nettoyage des fichiers temporaires (chunks, conversion) |

### 5.6 UI / UX

| ID | Exigence |
|---|---|
| F-UI-01 | Popup : bouton record/stop, statut, durée, meters de niveau micro/distant |
| F-UI-02 | Page options : clé API, provider, format, chunks, prompts, stratégie de capture |
| F-UI-03 | Feedback de progression (découpage, transcription chunk N/M, transformation) |
| F-UI-04 | Notifications de fin (transcript prêt, erreur) |
| F-UI-05 | Indicateur visuel d'enregistrement actif (badge sur l'icône) |

### 5.7 Cross-browser

| ID | Exigence |
|---|---|
| F-XB-01 | Manifest compatible Chromium (MV3) et Firefox (MV3, `browser_specific_settings`) |
| F-XB-02 | Détection de capacités (feature flags) pour choisir la stratégie |
| F-XB-03 | `webextension-polyfill` pour les petites différences d'API |
| F-XB-04 | Firefox : `world: "MAIN"` pour l'injection (FF 128+) |
| F-XB-05 | Documentation claire des limitations par OS/navigateur |

## 6. Exigences non-fonctionnelles

| ID | Exigence |
|---|---|
| NF-01 | **Open source MIT**, dépôt public, code lisible et commenté |
| NF-02 | **Audit des permissions** : un doc justifie chaque permission demandée |
| NF-03 | **Privacy-first** : aucune télémétrie, aucun envoi réseau non déclenché par l'utilisateur |
| NF-04 | Aucune dépendance opaque ; dépendances minimales et auditées |
| NF-05 | Build reproductible (lockfile) |
| NF-06 | Tests automatisés : unitaires (logique pure) + intégration (extension chargée via Playwright) |
| NF-07 | CI sur le serveur (Vitest + Playwright sous xvfb) |
| NF-08 | Performance : pas de blocage de l'onglet de visio, recording dans offscreen document (Chromium) |
| NF-09 | Accessibilité minimale du popup/options |
| NF-10 | Doc utilisateur + doc contributeur |

## 7. Matrice de support (capture audio distant)

| Navigateur | Stratégie | Micro | Audio distant (onglet) | Audio système complet |
|---|---|---|---|---|
| Chrome/Edge/Brave (Chromium) | `tabCapture` | ✅ | ✅ | ✅ Windows ; ❌ macOS/Linux (sauf driver virtuel) |
| Firefox 128+ | Interception WebRTC (MAIN world) | ✅ | ✅ (via WebRTC) | ❌ (sauf driver virtuel) |
| Firefox < 128 | — | ✅ | ❌ | ❌ |

## 8. Risques & ouvertures

| Risque | Mitigation |
|---|---|
| Détection/anti-tamper par les plateformes (Teams, Zoom web) sur l'interception WebRTC | Path `tabCapture` privilégié sur Chromium ; fallback documenté ; monitoring |
| APIs Web expérimentales (WebCodecs `AudioEncoder`) | Feature detection + fallback MediaRecorder |
| Fragilité du monkey-patch WebRTC (changements des plateformes) | Tests d'intégration avec page fixture WebRTC ; versionnage |
| Limites API transcription (rate, taille) | Chunking + concurrence limitée + retry backoff |
| Confidentialité de la clé API | `chrome.storage` (non sync), jamais loggée, options pour la chiffrer |
| Permissions perçues comme intrusives | Audit public + permission `optional` quand possible |

## 9. Critères de réussite (MVP)

- [ ] Enregistrement micro+distant fonctionne sur **Chrome** sur Meet **et** une autre plateforme web.
- [ ] Enregistrement fonctionne sur **Firefox** via interception WebRTC sur une page visio de test.
- [ ] Fichier `.webm/opus` produit, lisible, audio intelligible.
- [ ] Chunking + merge produit une transcription cohérente sur un audio de > 5 min.
- [ ] Pipeline 2 étapes avec Mistral API → transcript + résumé.
- [ ] Aucune donnée envoyée hors de l'action explicite de l'utilisateur.
- [ ] Audit des permissions publiable.
- [ ] Tests unitaires sur la logique (chunking/merge/config) verts.

## 10. Glossaire

- **OPFS** : Origin Private File System — stockage fichier persistant côté navigateur.
- **MAIN world** : contexte d'exécution JS de la page (vs ISOLATED world du content script).
- **Voxtral** : endpoint de transcription audio de Mistral.
