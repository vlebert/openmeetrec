# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioned with
[SemVer](https://semver.org/). Ongoing changes accumulate under "Unreleased" until the next
version.

## [Unreleased]

## [0.9.0] - 2026-10-22

### Added

- Mistral **Voxtral 3** model presets: `voxtral-mini-transcribe-3` (Voxtral Mini Transcribe 3) and
  `voxtral-small-transcribe-3` (Voxtral Small Transcribe 3, higher accuracy). The default model is
  unchanged: `voxtral-mini-latest` still points to Transcribe 2 (`voxtral-mini-2602`) on Mistral's
  side, and is now labelled "Voxtral Mini Transcribe 2".

### Changed

- Single-request transcription is capped at **45 minutes** with Voxtral 3 models, versus 1 h 30
  with Transcribe 2. Voxtral 3 counts the transcript in its 65,536-token context window along with
  the audio, so a long recording is either refused (1 h 29) or, worse, accepted and cut off without
  any error (1 h 25 came back with only its first 5 minutes). Longer meetings are chunked, so
  speaker labels are only consistent within each chunk.

### Fixed

- A Mistral response that fills the whole context window is now treated as truncated, and the
  recording is transcribed again in chunks, instead of exporting an incomplete transcript as if it
  were complete.
- Segments are sorted by start time even when the whole meeting is sent in a single request.
  Voxtral 3 may return overlapping diarized segments, and the export relied on the provider's order.
  A segment that overlaps the previous one no longer shortens the speaking turn or paragraph it
  belongs to.

## [0.8.0] - 2026-09-10

### Changed

- Markdown export, provider without diarization (OpenAI, or Mistral with the option off) but with
  timestamped segments: the transcript is now timestamped paragraphs (`(HH:MM:SS)` prefix, `---` at
  each chunk boundary) instead of a single wall of text. The plain undelimited block is kept only as
  a last resort, for a model that returns no timestamps at all.

## [0.7.0] - 2026-09-08

### Added

- **Single-request transcription** when the recording fits within the provider's limits. The point
  is not speed but diarization: a single pass assigns speakers across the whole meeting, whereas
  chunking re-attributed them for every chunk. The export therefore names speakers again
  (`**Speaker 0**`) and reports `speakers: N`. Measured against the Mistral API: 1 h 29 min goes
  through in a single request, transcribed at 99.9% of its duration.
- Automatic fallback to chunking: either upfront, when duration or size exceed the provider's
  limits — the decision is then made before any upload, so an overage never costs several minutes
  of wasted upload — or after a failure that chunking can resolve. An invalid key or an exhausted
  quota does not trigger this fallback: replaying it once per chunk would only burn requests.

- `npm run test:one-shot`: manual probe that sends an entire recording in a single request, reports
  acceptance or rejection along with the provider's error body, and checks that the transcription
  actually covers the full duration — an API may accept an overly long file and transcribe only its
  beginning without raising an error. `npm run test:real-api` now only runs the chunked path.
- `src/providers/limits.ts`: upload limits per provider and per model, measured against the real
  APIs rather than taken from their documentation (Mistral's contradicts itself: 60 min on one
  page, 3 h on another). This is what will decide, before any network call, between a single
  request and chunking.

### Changed

- The continuous audio track is now **always** recorded, not only when the "download audio" option
  is checked: it is what makes single-request transcription possible, and it cannot be
  reconstructed afterwards from the chunks. The user option now only governs the audio file output.
- Speaker identifiers from providers are normalized for display: Voxtral returns `speaker_1`, the
  export used to output `**speaker_1**` in lowercase instead of `**Speaker 1**`.

- Markdown export, transcription produced from multiple chunks: the "Speaker N" labels are no
  longer displayed. They were misleading — the provider attributes identities independently for
  each chunk, so "Speaker 0" before and after a boundary is not the same person, and a warning at
  the top of the file is not enough to keep in mind in the middle of the document. Diarization is
  now only used for formatting: one paragraph per speaking turn, prefixed with its timestamp
  `(HH:MM:SS)`. The former `**Chunk N**` subheadings are replaced by a `---` rule, which marks the
  seam without exposing an internal notion.
- The frontmatter no longer reports `speakers: N` in that case: the count was adding up identifiers
  local to each chunk.
- When the whole transcription fits in a **single request**, nothing changes: identities are
  consistent from start to end, the `**Speaker N**` labels and the `speakers:` count are kept.

## [0.6.0] - 2026-09-03

### Added

- "Reprocess transcription" button in the popup: as long as no new recording has started, a session
  that already completed successfully can be reprocessed (the chunks are still in OPFS), not only a
  failed session. A small "Previous recording available" text indicates this when the popup is
  reopened on a completed session.

## [0.5.0] - 2026-09-03

### Fixed

- A chunk with no speech (silence) caused the timestamps of the whole meeting to be lost, with the
  warning "The model in use does not return timestamps", even though the other chunks did have
  them. Confirmed against the Voxtral API: a silent chunk legitimately returns `segments: []`. That
  chunk now contributes nothing to the merge instead of degrading the whole document into raw
  concatenation.

### Changed

- Default chunking: 3 min / 10 s overlap (instead of 5 min / 30 s) — shorter chunks, more
  responsive to transcribe as the recording goes.
- `npm run test:real-api`: audio duration detection robust to MediaRecorder webm files without
  Cues/Duration in the header (full decoding instead of reading container metadata). Also checks
  that the timestamps returned by the provider fall within the bounds of the transcribed chunk,
  instead of silently assuming their unit and reference frame. Actually validated against Mistral
  (diarization) and OpenAI.

## [0.4.0] - 2026-09-01

### Added

- Recording reminder: when opening a page recognized as a video call, a system notification
  reminds to start the capture. Nothing is recorded automatically — starting remains a click on
  the extension icon, the only gesture that grants the permission to capture the tab.
- "Meeting reminder" settings: the list of meeting URLs (Meet, Teams, Zoom, Jitsi, Whereby,
  Webex…) is pre-filled and fully editable — one pattern per line, `*` as wildcard. Removing a line
  is enough to stop being reminded on that site; the whole option is disabled with a checkbox.

### Changed

- New `tabs` and `notifications` permissions, required by the reminder above: `tabs` because
  Chrome removes tab URLs without it, `notifications` to display the reminder. URLs are compared
  against the patterns then discarded — never stored nor sent. See
  `docs/permissions-audit.md`.

## [0.3.0] - 2026-08-30

### Added

- "Retry transcription" button in the popup: after a failure (network, key, API overload), the
  chunks remain in OPFS and the full pipeline can be re-run on the same session, without
  re-recording.
- `npm run test:real-api`: manual validation of the pipeline against a real API (Mistral/OpenAI),
  outside CI and outside `npm test` — splits a real audio file into chunks via `ffmpeg`, API key
  and audio file provided through environment variables, never committed.

### Changed

- Diarized transcription: consecutive segments from the same speaker are now grouped into a single
  paragraph (one speaking turn), instead of one paragraph per raw segment returned by the API
  (~10s). Grouping stops at each chunk boundary, because speaker identifiers are not matched from
  one chunk to the next.

### Fixed

- `downloadAndWait` would block forever when the downloaded file was tiny (e.g. a fully failed
  transcription): the download sometimes completed before the `chrome.downloads.onChanged` listener
  was attached. The current download state is now checked in addition to future events.

## [0.2.0] - 2026-08-29

First numbered release. Everything before it had accumulated under "Unreleased" since scaffolding:
the full recording → transcription → export chain stands in Chromium, but had never yet seen a
real API or a real video call.

### Added

- PRD and architecture (v0.3), permissions audit.
- Scaffolding: TypeScript strict, Vite, MV3 manifest.
- Capture chain: popup → service worker → offscreen document, mic + tab mix with audio
  re-injection, chunks written to OPFS during recording.
- Transcription: Mistral / OpenAI / custom endpoint providers, chunks → merge → Markdown export
  pipeline, download at the end of the session.
- Popup UI (start/stop, duration, levels) and settings page (provider, keys, options), in English.
- "REC" badge on the toolbar icon while recording, visible even with the popup closed.
- Toolbar icon turning red while recording, grey at rest: the state can be read without opening
  the popup, and the icon no longer pretends to record permanently.
- Warning and "Chunk N" sections in the exported markdown, to flag the speaker-identity break
  across chunks (unresolved in the MVP).
- End-to-end integration test in Chromium (`npm run test:e2e`).
- Logo: open ring in three arcs around a central dot (`src/assets/logo.svg`), declined into
  16/32/48/128 icons declared in the manifest.

### Changed

- VU meters (mic/tab): switched from a linear RMS scale to a dB scale — a normal voice stayed
  nearly invisible on the bar, the ear perceives loudness logarithmically.
- Exported transcription: the blockquote (`> …`) is removed, the transcription is plain markdown —
  it added nothing beyond superfluous formatting.

### Fixed

- `npm run build` on a freshly cloned repo: explicit error message when `node_modules/` is
  missing, instead of a stack trace pointing at the wrong file.
- API key placeholder in the settings: it displayed `sk-…` for all providers even though only
  OpenAI uses that format (Mistral, for instance, does not).
