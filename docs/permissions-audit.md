# OpenMeetRec — Audit des permissions

> Une entrée par permission déclarée dans `src/manifest.json`. Chaque entrée dit à quoi la permission
> sert, quand elle est effectivement utilisée, et ce qu'elle ne permet pas. Toute permission ajoutée
> au manifest doit être documentée ici (règle projet).

## Principes

- Aucune télémétrie, aucun envoi réseau qui ne soit déclenché par une action explicite de l'utilisateur.
- Aucune permission d'hôte sur les plateformes de visio : la capture passe par `activeTab`.
- Les clés API restent en `chrome.storage.local` (jamais `storage.sync`, jamais loggées).
- Le réseau est restreint aux API de transcription supportées ; l'accès élargi est **optionnel** et
  demandé à la volée.

## Permissions requises

### `activeTab`

- **Pourquoi** : accorde un accès temporaire à l'onglet sur lequel l'utilisateur ouvre le popup, ce
  qui autorise `tabCapture` sur cet onglet précis.
- **Quand** : au clic sur l'icône de l'extension, et uniquement pour cet onglet.
- **Ne permet pas** : de lire ou capturer d'autres onglets, ni d'agir en arrière-plan sur des onglets
  que l'utilisateur n'a pas explicitement désignés.
- **Alternative écartée** : `host_permissions` sur les domaines de visio — beaucoup plus large, et
  impossible à maintenir pour « n'importe quelle plateforme ».

### `tabCapture`

- **Pourquoi** : capturer l'audio des participants distants, qui n'est accessible que via le flux
  audio de l'onglet de visio.
- **Quand** : après un clic explicite sur Start, sur le `tabId` de l'onglet où le popup est ouvert.
- **Ne permet pas** : de capturer la vidéo (on ne demande que l'audio), ni de démarrer une capture
  sans geste utilisateur.
- **Effet de bord assumé** : la capture détourne le son de l'onglet ; il est ré-injecté vers la sortie
  audio pour que l'utilisateur continue d'entendre sa réunion (F-CAP-06).

### `offscreen`

- **Pourquoi** : un service worker MV3 n'a pas d'API DOM et peut être arrêté à tout moment. Le
  document offscreen tient `getUserMedia`, le graphe Web Audio et les `MediaRecorder` pendant toute la
  session.
- **Quand** : créé au Start, détruit à la fin du pipeline.
- **Ne permet pas** : d'afficher quoi que ce soit à l'utilisateur, ni d'accéder au contenu des pages.

### `storage`

- **Pourquoi** : persister la configuration (provider, modèle, options) et les clés API.
- **Quand** : lecture au démarrage d'une session, écriture depuis la page d'options.
- **Portée** : `chrome.storage.local` uniquement. Les clés API ne sont **jamais** écrites en
  `storage.sync` (qui les enverrait sur les serveurs du navigateur) ni journalisées.

### `downloads`

- **Pourquoi** : écrire le fichier Markdown final, et l'audio `.webm` si l'option est activée.
- **Quand** : à la fin du pipeline, ou sur clic du bouton de téléchargement.
- **Ne permet pas** : de lire les téléchargements existants de l'utilisateur (aucun appel à
  `chrome.downloads.search` sur autre chose que nos propres téléchargements).

## Permissions d'hôte

### `host_permissions: ["https://api.mistral.ai/*", "https://api.openai.com/*"]`

- **Pourquoi** : envoyer les chunks audio à l'API de transcription choisie, et tester la validité
  d'une clé.
- **Quand** : uniquement pendant un pipeline lancé par l'utilisateur, ou sur clic du bouton
  « tester la clé ».
- **Restriction** : limité aux deux API supportées en MVP. Aucun autre domaine n'est joignable par
  défaut.

### `optional_host_permissions: ["<all_urls>"]`

- **Pourquoi** : permettre le provider « Custom » (endpoint auto-hébergé, proxy d'entreprise,
  transcription locale…), dont l'URL est inconnue à l'avance.
- **Quand** : demandé à la volée, uniquement si l'utilisateur configure un endpoint custom dans les
  options. Jamais accordé à l'installation.
- **Ne permet pas** : d'accéder aux pages web de l'utilisateur — l'extension n'injecte aucun content
  script et n'utilise cette permission que pour `fetch` vers l'endpoint configuré.

## Non demandé (et pourquoi)

| Permission | Pourquoi on s'en passe |
|---|---|
| `tabs` | `activeTab` + le `tabId` connu du popup suffisent ; pas besoin de lire la liste des onglets |
| `scripting` / `content_scripts` | Aucune injection dans les pages en MVP |
| `<all_urls>` en requis | Réservé au provider custom, et alors seulement en optionnel |
| `desktopCapture` | `tabCapture` évite le picker système et l'accès à l'écran entier |
| `identity`, `cookies`, `history`, `bookmarks` | Sans rapport avec la fonction de l'extension |
| `storage.sync` | Les clés API ne doivent jamais quitter la machine |

## Vérification

- Les tests d'intégration (`options.spec.ts`) vérifient qu'aucune clé API n'apparaît dans les logs.
- Le manifest est lu par un test unitaire qui échoue si une permission non documentée ici est ajoutée.
