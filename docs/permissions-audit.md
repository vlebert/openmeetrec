# OpenMeetRec — Audit des permissions

> Une entrée par permission déclarée dans `src/manifest.json`. Chaque entrée dit à quoi la permission
> sert, quand elle est effectivement utilisée, et ce qu'elle ne permet pas. Toute permission ajoutée
> au manifest doit être documentée ici (règle projet).

## Principes

- Aucune télémétrie, aucun envoi réseau qui ne soit déclenché par une action explicite de l'utilisateur.
- Aucune permission d'hôte sur les plateformes de visio : la capture passe par `activeTab`, et
  aucun content script n'est injecté dans les pages.
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

### `tabs`

- **Pourquoi** : reconnaître qu'un onglet est sur une page de visioconférence, pour rappeler de
  lancer l'enregistrement (fonctionnalité « Meeting reminder »). Sans cette permission, les objets
  `Tab` renvoyés par l'API sont privés de `url`, `pendingUrl` et `title` : la détection est
  impossible depuis le service worker.
- **Quand** : sur `chrome.tabs.onUpdated`, uniquement pour comparer l'URL aux motifs de la liste
  configurée par l'utilisateur.
- **Ne permet pas** : d'accéder au *contenu* des pages (aucun content script, aucun `scripting`),
  ni de capturer un onglet — `tabCapture` continue d'exiger `activeTab`.
- **Ce qui est fait de l'URL** : elle est comparée aux motifs en mémoire, puis jetée. Seuls le
  `tabId` et le motif reconnu sont mémorisés en `chrome.storage.session`, le temps d'éviter une
  notification en double ; rien n'est écrit en `storage.local`, journalisé, ni envoyé sur le réseau.
- **Comment s'en passer** : décocher « Meeting reminder » dans les réglages désactive toute
  détection. La permission reste déclarée (Chrome ne permet pas de la rendre optionnelle), mais
  plus aucune URL n'est lue.
- **Alternative écartée** : un content script sur les domaines de visio (bannière dans la page)
  verrait le contenu des pages de réunion et imposerait des permissions d'hôte sur ces domaines —
  plus intrusif que de lire une URL, pour un résultat équivalent.

### `notifications`

- **Pourquoi** : afficher le rappel « vous êtes sur une page de visio, pensez à enregistrer ».
- **Quand** : à l'arrivée d'un onglet sur une URL reconnue, si l'option est active et qu'aucune
  session n'est en cours. Une notification par onglet et par motif reconnu.
- **Ne permet pas** : de lancer un enregistrement — un clic sur une notification n'accorde pas
  `activeTab`. Le clic ne fait que réactiver l'onglet concerné ; le départ reste un clic explicite
  sur l'icône de l'extension.

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
| `scripting` / `content_scripts` | Aucune injection dans les pages : le rappel de réunion passe par une notification système, pas par une bannière insérée dans la page |
| `<all_urls>` en requis | Réservé au provider custom, et alors seulement en optionnel |
| `desktopCapture` | `tabCapture` évite le picker système et l'accès à l'écran entier |
| `identity`, `cookies`, `history`, `bookmarks` | Sans rapport avec la fonction de l'extension |
| `storage.sync` | Les clés API ne doivent jamais quitter la machine |

## Vérification

- Les tests d'intégration (`options.spec.ts`) vérifient qu'aucune clé API n'apparaît dans les logs.
- Le manifest est lu par un test unitaire qui échoue si une permission non documentée ici est ajoutée.
