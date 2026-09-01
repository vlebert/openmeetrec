# OpenMeetRec

An open source, privacy-first browser extension that records the audio of your web
meetings, your microphone and every remote participant, on any video conferencing
platform, then transcribes it with the speech API of your choice (Mistral Voxtral or
OpenAI Whisper) and exports the result as Markdown.

No bot joining the call, no mandatory cloud service, no network request you didn't
trigger yourself.

> Working name. The project may be renamed at any point; the repository isn't tied to it.

## Why

There's no shortage of meeting recorders and transcription bots, but most of them are
tied to one specific video conferencing tool, join the call as a visible participant, or
route your audio through someone else's cloud. There wasn't a simple, open source option
that just works wherever you already are: OpenMeetRec captures the tab audio directly, so
it works with any video conferencing tool as long as you're using it in Chrome.

It's also deliberately scoped to transcription only, no automatic summary. In my
experience, a transcript turned straight into a summary without context (the project
brief, the notes from a previous meeting) comes out shallower than one written with that
context in hand. So this extension focuses on getting a clean transcript, live and right
after the meeting ends, and leaves what you do with it to you and whatever tool you
already use for that.

## How it works

- Click the extension icon to start recording; a red dot on the icon and a "REC" badge
  show it's running, even after you close the popup.
- Audio is mixed from your microphone and the tab (remote participants) and chunked
  locally while recording, so memory use doesn't grow with meeting length.
- When you stop, each chunk is sent to the transcription provider you configured, then
  merged and exported as a Markdown file, with no server in between beyond the API you
  chose.
- No video conferencing host permissions are requested: capture relies on `activeTab`,
  granted only for the tab you clicked the icon on. See
  [`docs/permissions-audit.md`](docs/permissions-audit.md) for the full breakdown of
  every permission the extension asks for and why.

## Status

MVP, Chromium only. Firefox is out of scope for now, though the capture layer is built
behind an interface so it can be added without rewriting the rest. See
[`CHANGELOG.md`](CHANGELOG.md) for what's shipped so far.

Known limitations:

- Not yet validated against a real transcription API or a real video call end to end,
  only against a local mock endpoint in Chromium.
- Speaker labels are assigned per chunk and aren't reconciled across chunks; the
  exported Markdown flags this with a visible "Chunk N" break.
- Timestamps are taken as returned by the provider; a provider returning a timestamp
  outside its own chunk's bounds would produce an inconsistent transcript.

## Development

```bash
npm install
npm test          # unit tests (Vitest) — pure logic, no browser
npm run typecheck
npm run build     # outputs dist/, loadable via chrome://extensions (developer mode)
npm run test:e2e  # integration: full session in Chromium (~1 min)
```

The build writes an unpacked extension to `dist/`: enable developer mode in
`chrome://extensions`, then "Load unpacked" and point it at `dist/`.

### Running the integration tests

They need an X display (headful) and Chromium. On a headless machine, a VNC server is
enough, no need for xvfb:

```bash
DISPLAY=:1 npm run test:e2e
```

Playwright normally downloads its own Chromium (`npx playwright install chromium`). If a
build is already present on the machine at a different revision than the one Playwright
expects, point at it instead of re-downloading:

```bash
OMR_CHROMIUM=~/.cache/ms-playwright/chromium-1232/chrome-linux64/chrome DISPLAY=:1 npm run test:e2e
```

### Validating against a real API (manual, outside CI)

`npm test` and `npm run test:e2e` never call a real API: the project rule is a mock
provider in CI, always. To occasionally check the pipeline against a real Mistral/OpenAI
response, without paying on every `git push`, there's a separate manual script:
`tests/manual/real-api.manual.ts`, run only via `npm run test:real-api`.

It splits a real audio file (long enough to produce several chunks) with `ffmpeg`, sends
each chunk to the provider you pick, then writes the resulting Markdown to
`test-results/` (git-ignored) for review. Nothing is committed, nothing is logged; the
API key is only ever used in the HTTP header.

Configure it with environment variables kept out of the repo (e.g. a file in your home
directory, never in the project):

```bash
# ~/.config/openmeetrec/test.env — never in the repo
export OMR_TEST_AUDIO=~/somewhere/long-recording.webm   # a few minutes, several chunks
export MISTRAL_API_KEY=...                               # or OPENAI_API_KEY, depending on provider
```

```bash
source ~/.config/openmeetrec/test.env
OMR_TEST_PROVIDER=mistral npm run test:real-api
OMR_TEST_PROVIDER=openai npm run test:real-api
```

Optional variables: `OMR_TEST_MODEL`, `OMR_TEST_DIARIZE=1`, `OMR_TEST_CHUNK_DURATION` /
`OMR_TEST_OVERLAP` (seconds, useful to force multiple chunks on a shorter file without
changing the product's own defaults), `OMR_TEST_ENDPOINT` (for the `custom` provider).

## Design choices

- Chunking, merging, config, formatting, and retry policy import neither `chrome` nor
  the DOM, so the fragile logic is covered by unit tests that run in milliseconds.
- Capture is abstracted behind a `CaptureStrategy` interface, leaving room for a Firefox
  implementation later without touching the rest of the pipeline.
- Chunks are produced while recording, not afterwards, so memory use doesn't depend on
  meeting length.
- Timestamped segments are always requested, regardless of diarization; that's what
  makes it possible to drop duplicated text at chunk boundaries without an extra LLM
  pass.

## Credits

The chunking/merge pipeline design is inspired by a Python project of mine called
`supervoxtral`, ported to TypeScript. Unlike supervoxtral, this project stops at
transcription and doesn't include a second, LLM-driven summarization step; that's
intentionally left to whatever tool you use downstream.

## License

MIT.
