# Chrome Web Store listing — copy/paste source

Not part of the repo (store/ is git-ignored). Draft to copy into the Developer Dashboard.

## Category

Productivity (closest fit; Communication would also work if you'd rather list it there).

## Language

English.

## Short description (132 characters max)

```
Records your video call audio and transcribes it with the API you choose. No bot, no mandatory cloud, open source.
```

(114 characters)

## Detailed description

```
OpenMeetRec records the audio of a video call, tab and microphone, then sends it to a speech-to-text API you configure to produce a Markdown transcript.

It captures the tab's audio directly, so it works with any video conferencing site running in Chrome, not just one platform. No bot joins the call, and nothing is recorded until you click the extension icon.

How it works:

- Click the icon to start recording. A red dot and a REC badge show it's running, even after you close the popup.
- Optionally get a reminder (a system notification) when you open a page that matches a video conferencing pattern you configured. Nothing starts automatically.
- Audio is mixed from your microphone and the tab, then split into chunks while recording, so memory use does not grow with meeting length.
- Each chunk is sent to your chosen provider (Mistral Voxtral or OpenAI Whisper, or a custom endpoint) as the meeting goes. A failed chunk can be retried without recording again.
- The transcript merges cleanly across chunk boundaries and can group consecutive segments from the same speaker where the provider supports diarization.
- The result is exported as a Markdown file. No server sits between your browser and the API you chose.

The extension is scoped to transcription only. It does not summarize the meeting for you; that step is left to whatever tool you already use downstream.

Permissions: capture uses activeTab, granted only for the tab you clicked the icon on. The optional meeting reminder needs the tabs permission to read that tab's URL (compared locally against your patterns, then discarded) and the notifications permission to show the reminder. Full breakdown: https://github.com/vlebert/openmeetrec/blob/master/docs/permissions-audit.md

Open source, MIT license: https://github.com/vlebert/openmeetrec
Privacy policy: https://github.com/vlebert/openmeetrec/blob/master/PRIVACY.md
```

## Single purpose description (Privacy practices tab)

```
Records the audio of the browser tab you choose (a video call's remote participants) and, optionally, your microphone, then sends the audio to a transcription API you configure to produce a timestamped transcript you can export as Markdown.
```

## Data usage tab

- Data collected: audio content, and the API key you enter (for authenticating your own requests to the provider you pick).
- Purpose: none of it is collected by the developer. Audio and the API key are sent only to the transcription provider you configured, only during a recording you started.
- Sold to third parties: no.
- Used for purposes unrelated to the item's core functionality: no.
- Used to determine creditworthiness or for lending: no.
- Privacy policy URL: `https://github.com/vlebert/openmeetrec/blob/master/PRIVACY.md`

## Permission justifications

Pulled straight from `docs/permissions-audit.md` (already in English), condensed to what the dashboard's per-permission text boxes expect.

**activeTab**
```
Grants temporary access to the tab where the user opens the popup, which is what authorizes tabCapture on that specific tab. Used only on click of the extension icon, for that tab alone.
```

**tabCapture**
```
Captures the audio of remote meeting participants, only accessible through the tab's audio stream. Used only after an explicit click on Start, on the tab where the popup is open. Only audio is captured, never video.
```

**offscreen**
```
An MV3 service worker has no DOM API and can be stopped at any time. The offscreen document holds getUserMedia, the Web Audio graph, and the MediaRecorders for the whole recording session.
```

**storage**
```
Persists user configuration (provider, model, options) and API keys locally. Only chrome.storage.local is used; API keys are never written to storage.sync or logged.
```

**tabs**
```
Used to recognize that a tab is on a video conferencing page, to show a reminder to start recording (the optional "Meeting reminder" feature). Without this permission, the Tab objects returned by the API have no url, pendingUrl, or title, so detection is impossible. The URL is compared in memory to user-configured patterns, then discarded; nothing is logged or sent over the network. The feature can be disabled in settings.
```

**notifications**
```
Shows the meeting reminder notification when a tab lands on a recognized URL and no recording is running. Clicking the notification only refocuses the tab; it does not start a recording, which always requires an explicit click on the extension icon.
```

**downloads**
```
Writes the final Markdown transcript, and the .webm audio if the user enables that option, at the end of a session or on click of the download button.
```

**host_permissions (api.mistral.ai, api.openai.com)**
```
Sends audio chunks to the transcription API the user selected, and tests the validity of an API key. Limited to the two providers supported out of the box; only used during a user-started session or on click of "Test key".
```

**optional_host_permissions (<all_urls>)**
```
Enables the "Custom" provider for a self-hosted endpoint, corporate proxy, or local transcription server whose URL isn't known in advance. Requested on the fly only if the user configures a custom endpoint in settings, never granted at install time. No content script is injected; the permission is only used for fetch calls to the configured endpoint.
```

## Screenshots

`store/screenshots/1-options.png`, `2-popup-idle.png`, `3-popup-recording.png` — 1280x800, ready to upload.

## Package

`store/openmeetrec-0.4.0.zip` — built from `dist/` (manifest 0.4.0).
