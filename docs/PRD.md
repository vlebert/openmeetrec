# OpenMeetRec — PRD

> Version 0.2. MVP focalisé Chromium. Firefox hors scope (point d'extension prévu en architecture).

## 1. Vision

Extension de navigateur **open source et auditable** qui enregistre l'audio d'une visio web (micro local + participants distants via partage d'onglet), le découpe en chunks, le transcrit via une API au choix (Mistral Voxtral ou OpenAI Whisper), et exporte un fichier **Markdown** téléchargé à la fin. Aucun bot, aucun envoi cloud non déclenché par l'utilisateur.

## 2. Périmètre

### Dans le scope (MVP)

- Extension Chromium (MV3). Firefox hors scope, architecture extensible.
- Capture : **micro** (`getUserMedia`) + **onglet partagé** (`chrome.tabCapture`), mélangés en un flux.
- Chunking 5 min + overlap 30 s, transcription parallèle, merge crossfade.
- Transcription via **Mistral Voxtral** (diarization en option) ou **OpenAI Whisper** (pas de diarization).
- Menu déroulant de modèles connus + endpoint/modèle custom.
- Export **Markdown** téléchargé : frontmatter (modèle, date, durée, plateforme, speakers) + transcription en blockquote.
- Option : télécharger aussi le fichier **audio** `.webm` (ou seulement le markdown).
- Paramètres : choix du provider/modèle + clés API (+ test de clé).
- Page de recording dédiée (onglet extension) avec bouton, statut, meters, progression.

### Hors scope (MVP)

- Firefox (point d'extension prévu).
- Étape 2 LLM (résumé, action items) — transcription seule.
- Mode live / streaming.
- Vidéo, bot cloud, apps desktop de visio.
- Diarization fallback côté extension quand le provider ne la supporte pas.

### Plus tard

- Support Firefox (interception WebRTC en MAIN world).
- Étape 2 LLM configurable (prompts).
- Transcription locale (Whisper.cpp WASM / Ollama).
- Mode live.

## 3. UX

**Deux vues :**

1. **Page de recording** (`record.html`, onglet plein écran de l'extension) : bouton Start/Stop, durée, meters de niveau (micro + onglet), statut (recording / chunking / transcribing chunk N/M / done), bouton de téléchargement à la fin.
2. **Page de paramètres** (`options.html`) : provider (Mistral / OpenAI / Custom), modèle (dropdown + custom), endpoint custom, clé API par provider, bouton « tester la clé », option diarization (Mistral uniquement), option « télécharger l'audio aussi ».

Lancement : clic sur l'icône de l'extension → ouvre la page de recording. L'utilisateur clique Start → l'extension demande la permission micro + lance le `tabCapture` de l'onglet courant (la visio). Stop → pipeline → download.

## 4. Capture

| ID | Exigence |
|---|---|
| F-CAP-01 | Start/Stop depuis la page de recording |
| F-CAP-02 | Micro via `getUserMedia` |
| F-CAP-03 | Audio de l'onglet via `chrome.tabCapture` (onglet courant) |
| F-CAP-04 | Mix micro + onglet en un flux mono |
| F-CAP-05 | Aucune capture avant clic explicite |
| F-CAP-06 | Arrêt propre + sauvegarde sur navigation/fermeture d'onglet |

## 5. Audio & chunking

| ID | Exigence |
|---|---|
| F-AUD-01 | Sortie audio uniquement (webm/opus via MediaRecorder) |
| F-AUD-02 | Format brut envoyé tel quel aux API ; resampling 16 kHz mono seulement si une API le réclame |
| F-AUD-03 | Découpage en chunks de 5 min avec overlap 30 s |
| F-AUD-04 | Transcription parallèle des chunks (concurrence limitée) |
| F-AUD-05 | Merge crossfade au milieu de l'overlap (segments) ou concaténation (texte) |
| F-AUD-06 | Ajustement des timestamps à l'absolu |

## 6. Transcription

| ID | Exigence |
|---|---|
| F-TR-01 | Provider Mistral : endpoint Voxtral (`voxtral-mini-latest`) |
| F-TR-02 | Provider OpenAI : endpoint Whisper (`whisper-1` / modèles transcription) |
| F-TR-03 | Provider Custom : endpoint + modèle libres |
| F-TR-04 | Diarization : option activable **chez Mistral uniquement** ; renvoie segments + `speaker_id` |
| F-TR-05 | OpenAI : pas de diarization → transcript plat (limitation documentée) |
| F-TR-06 | Gestion d'erreur API : rate limit, timeout, retry avec backoff |
| F-TR-07 | Provider mock intégré pour les tests (hors réseau) |

## 7. Export

| ID | Exigence |
|---|---|
| F-EX-01 | Téléchargement d'un fichier **Markdown** à la fin |
| F-EX-02 | Frontmatter : `model`, `date`, `duration`, `platform` (URL de l'onglet), `speakers` (si diarization), `extension_version` |
| F-EX-03 | Corps : transcription dans un blockquote `>` |
| F-EX-04 | Avec diarization : un blockquote par segment avec speaker + timestamp (`> **Speaker 0** (00:12:34): …`) |
| F-EX-05 | Sans diarization : un seul blockquote avec le texte continu |
| F-EX-06 | Option paramètre : télécharger aussi le fichier audio `.webm` (défaut : markdown seul) |

## 8. Paramètres

| ID | Exigence |
|---|---|
| F-OP-01 | Choix du provider : Mistral / OpenAI / Custom |
| F-OP-02 | Modèle : dropdown (Voxtral mini, Whisper-1, …) + champ custom |
| F-OP-03 | Endpoint custom (pour provider Custom) |
| F-OP-04 | Clé API par provider, stockée en `chrome.storage.local` (jamais sync) |
| F-OP-05 | Bouton « tester la clé » (appel ping, feedback OK/KO) |
| F-OP-06 | Toggle diarization (visible/actif uniquement si Mistral sélectionné) |
| F-OP-07 | Toggle « télécharger l'audio en plus du markdown » |

## 9. Non-fonctionnel

| ID | Exigence |
|---|---|
| NF-01 | Open source MIT, dépôt public, code lisible |
| NF-02 | Audit des permissions (doc justifiant chaque permission) |
| NF-03 | Privacy-first : aucune télémétrie, aucun envoi réseau non déclenché par l'utilisateur |
| NF-04 | Dépendances minimales auditées, build reproductible (lockfile) |
| NF-05 | Tests unitaires sur la logique pure (chunking/merge/config/providers) |
| NF-06 | Tests d'intégration : extension chargée via Playwright + page fixture WebRTC |
| NF-07 | Recording dans un offscreen document (ne bloque pas l'onglet de visio) |

## 10. Matrice de support (MVP)

| Navigateur | Micro | Audio onglet | Diarization |
|---|---|---|---|
| Chrome/Edge/Brave (Chromium) | ✅ | ✅ (`tabCapture`) | ✅ Mistral ; ❌ OpenAI |
| Firefox | hors scope (point d'extension prévu) | — | — |

## 11. Risques

| Risque | Mitigation |
|---|---|
| API refuse le webm/opus brut | Resampling 16 kHz mono en fallback ; test par provider |
| Diarization absente chez OpenAI | Documenté ; transcript plat ; diarization Mistral dès qu'activée |
| Fragilité du chunking/merge | Tests unitaires poussés (ports depuis supervoxtral) |
| Rate limit API | Concurrence limitée + retry backoff |
| Permissions perçues intrusives | Audit public + permissions `optional` quand possible |

## 12. Critères de réussite (MVP)

- [ ] Record micro+onglet sur Chrome, sur Meet et une autre plateforme web.
- [ ] `.webm/opus` produit, audio intelligible.
- [ ] Chunking + merge → transcription cohérente sur un audio > 5 min.
- [ ] Transcription Mistral avec diarization → markdown structuré par speaker.
- [ ] Transcription OpenAI → markdown plat.
- [ ] Téléchargement markdown (+ audio si option activée).
- [ ] Aucune donnée envoyée hors action explicite.
- [ ] Tests unitaires (chunking/merge/config) verts.

## 13. Glossaire

- **tabCapture** : API Chromium pour capturer l'audio/vidéo de l'onglet courant, sans picker de partage.
- **OPFS** : Origin Private File System — stockage fichier persistant côté extension.
- **Voxtral** : endpoint de transcription audio de Mistral (diarization supportée).
- **Whisper** : endpoint de transcription d'OpenAI (pas de diarization native).
