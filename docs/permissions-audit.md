# OpenMeetRec — Permissions audit

> One entry per permission declared in `src/manifest.json`. Each entry says what the permission
> is for, when it's actually used, and what it doesn't allow. Any permission added to the
> manifest must be documented here (project rule).

## Principles

- No telemetry, no network call that isn't triggered by an explicit user action.
- No host permission on video conferencing platforms: capture goes through `activeTab`, and
  no content script is injected into pages.
- API keys stay in `chrome.storage.local` (never `storage.sync`, never logged).
- Network access is restricted to the supported transcription APIs; broader access is
  **optional** and requested on demand.

## Required permissions

### `activeTab`

- **Why**: grants temporary access to the tab the user opens the popup on, which authorizes
  `tabCapture` on that specific tab.
- **When**: on click of the extension icon, and only for that tab.
- **Does not allow**: reading or capturing other tabs, or acting in the background on tabs
  the user hasn't explicitly designated.
- **Alternative discarded**: `host_permissions` on video conferencing domains — much broader,
  and impossible to maintain for "any platform".

### `tabCapture`

- **Why**: capture the audio of remote participants, which is only accessible through the
  audio stream of the meeting tab.
- **When**: after an explicit click on Start, on the `tabId` of the tab the popup is open on.
- **Does not allow**: capturing video (only audio is requested), or starting a capture
  without a user gesture.
- **Accepted side effect**: the capture diverts the tab's sound; it is re-injected to the
  audio output so the user keeps hearing their meeting (F-CAP-06).

### `offscreen`

- **Why**: an MV3 service worker has no DOM API and can be stopped at any time. The offscreen
  document holds `getUserMedia`, the Web Audio graph and the `MediaRecorder`s for the whole
  session.
- **When**: created on Start, destroyed at the end of the pipeline.
- **Does not allow**: displaying anything to the user, or accessing page content.

### `storage`

- **Why**: persist configuration (provider, model, options) and API keys.
- **When**: read at the start of a session, written from the options page.
- **Scope**: `chrome.storage.local` only. API keys are **never** written to `storage.sync`
  (which would send them to the browser's servers) nor logged.

### `tabs`

- **Why**: recognize that a tab is on a video conferencing page, to remind the user to start
  recording (the "Meeting reminder" feature). Without this permission, the `Tab` objects
  returned by the API are stripped of `url`, `pendingUrl` and `title`: detection is impossible
  from the service worker.
- **When**: on `chrome.tabs.onUpdated`, only to compare the URL against the pattern list
  configured by the user.
- **Does not allow**: accessing page *content* (no content script, no `scripting`), or
  capturing a tab — `tabCapture` still requires `activeTab`.
- **What is done with the URL**: it is compared against the in-memory patterns, then
  discarded. Only the `tabId` and the matched pattern are kept in
  `chrome.storage.session`, to avoid a duplicate notification; nothing is written to
  `storage.local`, logged, or sent over the network.
- **How to opt out**: unchecking "Meeting reminder" in settings disables all detection. The
  permission stays declared (Chrome doesn't allow making it optional), but no URL is read
  anymore.
- **Alternative discarded**: a content script on video conferencing domains (an in-page
  banner) would see the content of meeting pages and require host permissions on those
  domains — more intrusive than reading a URL, for an equivalent result.

### `notifications`

- **Why**: show the reminder "you're on a video conferencing page, remember to record".
- **When**: when a tab lands on a recognized URL, if the option is enabled and no session is
  currently running. One notification per tab and per matched pattern.
- **Does not allow**: starting a recording — clicking a notification doesn't grant
  `activeTab`. The click only refocuses the relevant tab; starting a recording remains an
  explicit click on the extension icon.

### `downloads`

- **Why**: write the final Markdown file, and the `.webm` audio if the option is enabled.
- **When**: at the end of the pipeline, or on click of the download button.
- **Does not allow**: reading the user's existing downloads (no call to
  `chrome.downloads.search` on anything other than our own downloads).

## Host permissions

### `host_permissions: ["https://api.mistral.ai/*", "https://api.openai.com/*"]`

- **Why**: send audio chunks to the chosen transcription API, and test a key's validity.
- **When**: only during a pipeline started by the user, or on click of the "test key" button.
- **Restriction**: limited to the two APIs supported in the MVP. No other domain is reachable
  by default.

### `optional_host_permissions: ["<all_urls>"]`

- **Why**: enable the "Custom" provider (self-hosted endpoint, corporate proxy, local
  transcription…), whose URL is unknown in advance.
- **When**: requested on the fly, only if the user configures a custom endpoint in the
  options. Never granted at install time.
- **Does not allow**: accessing the user's web pages — the extension injects no content
  script and only uses this permission for `fetch` calls to the configured endpoint.

## Not requested (and why)

| Permission | Why we do without it |
|---|---|
| `scripting` / `content_scripts` | No injection into pages: the meeting reminder goes through a system notification, not a banner inserted into the page |
| `<all_urls>` as required | Reserved for the custom provider, and only as optional there |
| `desktopCapture` | `tabCapture` avoids the system picker and full-screen access |
| `identity`, `cookies`, `history`, `bookmarks` | Unrelated to the extension's function |
| `storage.sync` | API keys must never leave the machine |

## Verification

- Integration tests (`options.spec.ts`) check that no API key appears in the logs.
- The manifest is read by a unit test that fails if a permission not documented here is added.
