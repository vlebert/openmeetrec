# OpenMeetRec — PRD

> Version 0.3. MVP focalisé Chromium. Firefox hors scope (point d'extension prévu en architecture).
>
> Changements v0.2 → v0.3 : UI de contrôle en **popup** sur l'onglet de visio (ciblage explicite de l'onglet),
> **chunking au fil de l'eau** (mémoire bornée), **segments horodatés demandés systématiquement**
> (merge sans doublons même sans diarization).

## 1. Vision

Extension de navigateur **open source et auditable** qui enregistre l'audio d'une visio web (micro local + participants distants via capture d'onglet), le découpe en chunks, le transcrit via une API au choix (Mistral Voxtral ou OpenAI Whisper), et exporte un fichier **Markdown** téléchargé à la fin. Aucun bot, aucun envoi cloud non déclenché par l'utilisateur.

## 2. Périmètre

### Dans le scope (MVP)

- Extension Chromium (MV3). Firefox hors scope, architecture extensible.
- Capture : **micro** (`getUserMedia`) + **onglet de visio** (`chrome.tabCapture`), mélangés en un flux mono.
- Chunking 3 min + overlap 10 s **produit pendant l'enregistrement**, transcription parallèle, merge par segments.
- Transcription via **Mistral Voxtral** (diarization en option) ou **OpenAI Whisper** (pas de diarization).
- Menu déroulant de modèles connus + endpoint/modèle custom.
- Export **Markdown** téléchargé : frontmatter (modèle, date, durée, plateforme, speakers) + transcription en markdown simple.
- Option : télécharger aussi le fichier **audio** `.webm` (ou seulement le markdown).
- Paramètres : choix du provider/modèle + clés API (+ test de clé).
- **Popup** de contrôle sur l'onglet de visio + page de progression/résultat.

### Hors scope (MVP)

- Firefox (point d'extension prévu).
- Étape 2 LLM (résumé, action items) — transcription seule.
- Mode live / streaming (transcription affichée en temps réel).
- Vidéo, bot cloud, apps desktop de visio.
- Diarization fallback côté extension quand le provider ne la supporte pas.
- Ré-appariement des `speaker_id` entre chunks (limitation documentée, cf. §6).

### Plus tard

- Support Firefox (interception WebRTC en MAIN world).
- Étape 2 LLM configurable (prompts).
- Transcription locale (Whisper.cpp WASM / Ollama).
- Mode live.

## 3. UX

**Trois surfaces :**

1. **Popup** (`ui/popup.html`), ouvert par clic sur l'icône **depuis l'onglet de visio** : bouton Start/Stop, durée, meters de niveau (micro + onglet), statut court. C'est la surface de contrôle principale : elle s'ouvre sur l'onglet à capturer, ce qui lève toute ambiguïté sur la cible et fournit le grant `activeTab` sur le bon onglet.
2. **Page de session** (`ui/record.html`, onglet plein écran) : statut détaillé (recording / chunking / transcribing chunk N/M / done), progression par chunk, erreurs, bouton de téléchargement. Ouverte automatiquement au Stop, ou à la demande depuis le popup.
3. **Page de paramètres** (`ui/options.html`) : provider (Mistral / OpenAI / Custom), modèle (dropdown + custom), endpoint custom, clé API par provider, bouton « tester la clé », option diarization (Mistral uniquement), option « télécharger l'audio aussi ».

**Parcours nominal :** l'utilisateur est sur sa visio → clic sur l'icône → popup → Start → permission micro demandée + `tabCapture` de cet onglet → l'enregistrement continue dans l'offscreen document même si le popup se ferme → Stop (depuis le popup ou la page de session) → pipeline → download.

L'enregistrement ne dépend jamais de la durée de vie du popup : fermer le popup n'arrête rien.

## 4. Capture

| ID | Exigence |
|---|---|
| F-CAP-01 | Start/Stop depuis le popup (et Stop aussi depuis la page de session) |
| F-CAP-02 | Micro via `getUserMedia` |
| F-CAP-03 | Audio de l'onglet via `chrome.tabCapture`, ciblant **l'onglet sur lequel le popup a été ouvert** (`targetTabId` explicite) |
| F-CAP-04 | Mix micro + onglet en un flux mono |
| F-CAP-05 | Aucune capture avant clic explicite sur Start |
| F-CAP-06 | **Le son de l'onglet reste audible pour l'utilisateur pendant la capture** (ré-injection du flux vers la sortie) |
| F-CAP-07 | Arrêt propre + finalisation de l'enregistrement si l'onglet capturé est fermé ou navigue ailleurs |
| F-CAP-08 | Un seul enregistrement à la fois ; le popup reflète l'état en cours quel que soit l'onglet |

## 5. Audio & chunking

| ID | Exigence |
|---|---|
| F-AUD-01 | Sortie audio uniquement (webm/opus via MediaRecorder) |
| F-AUD-02 | Format brut envoyé tel quel aux API ; resampling 16 kHz mono seulement si une API le réclame |
| F-AUD-03 | Chunks de 3 min avec overlap 10 s, **produits pendant l'enregistrement** (mémoire bornée, indépendante de la durée) |
| F-AUD-04 | Chunks persistés en OPFS au fil de l'eau ; aucun décodage de l'enregistrement complet en mémoire |
| F-AUD-05 | Transcription parallèle des chunks (concurrence limitée) |
| F-AUD-06 | Merge par segments avec coupe au milieu de la zone d'overlap |
| F-AUD-07 | Ajustement des timestamps à l'absolu (offset du chunk) |
| F-AUD-08 | Piste continue conservée en OPFS pour l'export audio optionnel |

## 6. Transcription

| ID | Exigence |
|---|---|
| F-TR-01 | Provider Mistral : endpoint Voxtral (`voxtral-mini-latest`) |
| F-TR-02 | Provider OpenAI : endpoint Whisper (`whisper-1`, `verbose_json`) |
| F-TR-03 | Provider Custom : endpoint + modèle libres |
| F-TR-04 | **Segments horodatés demandés systématiquement**, indépendamment de la diarization — c'est ce qui permet le merge sans doublons |
| F-TR-05 | Diarization : option activable **chez Mistral uniquement** ; ajoute `speaker_id` aux segments |
| F-TR-06 | OpenAI : pas de diarization → segments sans `speaker_id` (limitation documentée dans l'UI) |
| F-TR-07 | Si un provider/modèle ne renvoie pas de segments : fallback concaténation, avec **avertissement explicite** sur le risque de doublons aux frontières de chunks |
| F-TR-08 | Gestion d'erreur API : rate limit, timeout, retry avec backoff |
| F-TR-09 | Provider mock intégré pour les tests (hors réseau) |

**Limitation documentée — continuité des speakers :** les `speaker_id` sont attribués par le provider indépendamment pour chaque chunk. « Speaker 0 » du chunk 1 n'est donc pas nécessairement « Speaker 0 » du chunk 2. En MVP, aucun ré-appariement n'est tenté ; la limitation est signalée dans le markdown exporté dès que l'enregistrement dépasse un chunk et que la diarization est active.

## 7. Export

| ID | Exigence |
|---|---|
| F-EX-01 | Téléchargement d'un fichier **Markdown** à la fin |
| F-EX-02 | Frontmatter : `model`, `provider`, `date`, `duration`, `platform` (hôte de l'onglet), `speakers` (si diarization), `extension_version` |
| F-EX-03 | Corps : transcription dans un blockquote `>` |
| F-EX-04 | Avec diarization : un blockquote par segment avec speaker + timestamp (`> **Speaker 0** (00:12:34): …`) |
| F-EX-05 | Sans diarization : un seul blockquote avec le texte continu |
| F-EX-06 | Option paramètre : télécharger aussi le fichier audio `.webm` (défaut : markdown seul) |

## 8. Paramètres

| ID | Exigence |
|---|---|
| F-OP-01 | Choix du provider : Mistral / OpenAI / Custom |
| F-OP-02 | Modèle : dropdown de presets **renvoyant des segments** + champ custom |
| F-OP-03 | Endpoint custom (pour provider Custom) |
| F-OP-04 | Clé API par provider, stockée en `chrome.storage.local` (jamais sync, jamais loggée) |
| F-OP-05 | Bouton « tester la clé » (appel ping, feedback OK/KO) |
| F-OP-06 | Toggle diarization (visible/actif uniquement si Mistral sélectionné) |
| F-OP-07 | Toggle « télécharger l'audio en plus du markdown » |

**Presets de modèles.** Seuls les modèles renvoyant des segments horodatés sont proposés par défaut : `voxtral-mini-latest` (Mistral), `whisper-1` (OpenAI). `gpt-4o-transcribe` n'expose pas de segments (`verbose_json` non supporté) : accessible uniquement via le champ custom, avec l'avertissement F-TR-07.

## 9. Non-fonctionnel

| ID | Exigence |
|---|---|
| NF-01 | Open source MIT, dépôt public, code lisible |
| NF-02 | Audit des permissions (`docs/permissions-audit.md` justifiant chaque permission) |
| NF-03 | Privacy-first : aucune télémétrie, aucun envoi réseau non déclenché par l'utilisateur |
| NF-04 | Dépendances minimales auditées, build reproductible (lockfile) |
| NF-05 | Tests unitaires sur la logique pure (chunking/merge/config/format/providers) |
| NF-06 | Tests d'intégration : extension chargée via Playwright + page fixture WebRTC |
| NF-07 | Recording dans un offscreen document (ne bloque pas l'onglet de visio, survit à la fermeture du popup) |
| NF-08 | Mémoire bornée : l'empreinte de l'enregistrement ne croît pas avec sa durée |

## 10. Matrice de support (MVP)

| Navigateur | Micro | Audio onglet | Segments | Diarization |
|---|---|---|---|---|
| Chrome/Edge/Brave (Chromium) | ✅ | ✅ (`tabCapture`) | ✅ | ✅ Mistral ; ❌ OpenAI |
| Firefox | hors scope (point d'extension prévu) | — | — | — |

## 11. Risques

| Risque | Mitigation |
|---|---|
| API refuse le webm/opus brut | Resampling 16 kHz mono en fallback ; test par provider |
| Diarization absente chez OpenAI | Documenté ; segments sans speaker ; diarization Mistral dès qu'activée |
| `speaker_id` incohérents entre chunks | Limitation documentée en MVP (cf. §6) ; ré-appariement post-MVP |
| Fragilité du chunking/merge | Tests unitaires poussés (ports depuis supervoxtral) |
| Rate limit API | Concurrence limitée + retry backoff |
| Permissions perçues intrusives | Audit public + permissions `optional` quand possible |
| Onglet capturé fermé en cours de route | F-CAP-07 : finalisation propre, chunks déjà en OPFS conservés |

## 12. Critères de réussite (MVP)

- [ ] Record micro+onglet sur Chrome, sur Meet et une autre plateforme web, **sans perdre le son de la visio**.
- [ ] `.webm/opus` produit, audio intelligible.
- [ ] Chunking + merge → transcription cohérente sur un audio > 3 min, **sans texte dupliqué aux frontières**.
- [ ] Transcription Mistral avec diarization → markdown structuré par speaker.
- [ ] Transcription OpenAI → markdown plat.
- [ ] Téléchargement markdown (+ audio si option activée).
- [ ] Aucune donnée envoyée hors action explicite.
- [ ] Tests unitaires (chunking/merge/config/format) verts.
- [ ] Enregistrement d'1 h sans dérive mémoire notable.

## 13. Glossaire

- **tabCapture** : API Chromium pour capturer l'audio/vidéo d'un onglet désigné, sans picker de partage.
- **offscreen document** : page invisible d'une extension MV3, qui peut tenir des API DOM (Web Audio, MediaRecorder) hors du service worker.
- **OPFS** : Origin Private File System — stockage fichier persistant côté extension.
- **Voxtral** : endpoint de transcription audio de Mistral (diarization supportée).
- **Whisper** : endpoint de transcription d'OpenAI (pas de diarization native).
