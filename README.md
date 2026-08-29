# OpenMeetRec

Extension de navigateur **open source, privacy-first et cross-browser** pour enregistrer l'audio des vidéoconférences web (micro + participants distants), sur **n'importe quelle plateforme de visio**, puis le transformer en texte via un pipeline LLM (transcription + transformation).

> Nom de travail — peut être renommé à tout moment. Le dépôt est indépendant du nom.

- **PRD** : [`docs/PRD.md`](docs/PRD.md)
- **Architecture** : [`docs/architecture.md`](docs/architecture.md)

## État

🟡 Conception (PRD + architecture). Le développement commence après validation des docs.

## Origine du projet

Synthèse de plusieurs recherches :
- Le terrain « extension OSS auditable, cross-browser, avec pipeline LLM local optionnel » est largement vacant.
- La logique de pipeline (chunking, conversion, merge) s'inspire du projet Python [`supervoxtral`](../../py/supervoxtral) et doit être portée en TS/Web Audio. NB : supervoxtral fait aussi une 2e étape LLM (transformation) qui est hors scope MVP ici (transcription seule).
- La capture audio doit fonctionner sur Chromium **et** Firefox, ce qui impose deux stratégies de capture (`tabCapture` côté Chromium, interception WebRTC en MAIN world côté Firefox).

## Licence

MIT (à confirmer).
