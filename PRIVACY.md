# OpenMeetRec — Privacy Policy

Last updated: 2026-09-02

OpenMeetRec is an open source browser extension. This policy describes what happens to
your data when you use it. The extension's full source code is public, so every claim
below can be checked directly against the code — see in particular
[`docs/permissions-audit.md`](docs/permissions-audit.md) for a permission-by-permission
breakdown.

## Summary

- We (the developers) collect nothing. There is no analytics, no telemetry, no server
  operated by this project.
- The audio you choose to record and the API key you configure are sent only to the
  transcription provider **you pick** (Mistral, OpenAI, or a custom endpoint you enter
  yourself), and only when you explicitly start a recording or test a key.
- Everything else (configuration, API keys) stays on your machine, in your browser's
  local extension storage.

## What data the extension handles

### Audio

- Captured only after you click Start, from the tab where the extension's popup is open
  (`activeTab` + `tabCapture`).
- Sent, in chunks, to the transcription API you configured — and to no other destination.
- Never uploaded anywhere unless you start a recording; nothing is captured passively or
  in the background.
- The resulting transcript (and, if you enable the option, the raw `.webm` audio) is
  written to a file on your machine through the browser's normal download mechanism
  (`downloads`). We never receive a copy.

### API keys

- Stored in `chrome.storage.local`, on your machine only.
- Never written to `chrome.storage.sync` (which would sync them through the browser
  vendor's servers) and never logged.
- Sent only in requests to the transcription API you configured, to authenticate those
  requests.

### Tab URLs and titles

- The optional "Meeting reminder" feature reads the URL/title of tabs (`tabs` permission)
  to detect when you've opened a page matching a video conferencing pattern you configured,
  and show a system notification (`notifications`).
- The URL is compared in memory against your configured patterns and then discarded.
  Only the tab ID and matched pattern are kept, temporarily, in `chrome.storage.session`
  (cleared when the browser session ends) to avoid showing a duplicate notification.
- This data is never sent over the network and never written to persistent storage.
- You can disable this feature entirely in the options page.

## Third parties

The only third parties involved are the transcription providers **you choose to
configure**:

- Mistral AI (`api.mistral.ai`)
- OpenAI (`api.openai.com`)
- Or a custom, self-hosted, or third-party endpoint you enter yourself, if you use the
  "Custom" provider option

Audio chunks and your API key are sent to whichever provider you've configured, subject
to that provider's own privacy policy and terms. OpenMeetRec has no relationship with
these providers beyond making API calls on your behalf, and does not share any data with
them beyond what's required to transcribe the audio you submit.

We do not sell, rent, or share your data with anyone else. We do not use your data for
advertising or for any purpose other than performing the transcription you requested.

## Your controls

- Recording only ever starts on an explicit click.
- The "Meeting reminder" feature can be turned off in the options page.
- You choose which transcription provider to use, and can revoke its API key at any time
  from that provider's own dashboard.
- Uninstalling the extension removes all locally stored configuration and keys.

## Changes to this policy

Since this project is open source, changes to this file are visible in the repository's
history. Material changes will be reflected here with an updated "Last updated" date.

## Contact

Questions or concerns: open an issue on
[github.com/vlebert/openmeetrec](https://github.com/vlebert/openmeetrec/issues).
