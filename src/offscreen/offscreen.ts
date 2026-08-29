/**
 * Offscreen document — tient la capture et l'enregistrement pendant toute la
 * session (architecture §3.2).
 *
 * C'est le seul contexte de l'extension qui survit à la fermeture du popup tout
 * en ayant un DOM : le service worker MV3 peut être tué à tout moment, le popup
 * disparaît au premier clic ailleurs.
 */

import { ChunkScheduler, type RecorderLike } from '@/audio/chunkScheduler';
import { createMixer, type Mixer } from '@/audio/mix';
import { TabCaptureStrategy } from '@/capture/tabCaptureStrategy';
import { isForOffscreen, type Ack, type AudioLevels, type SessionError, type ToOffscreenMessage, type ToWorkerMessage } from '@/shared/messages';
import * as opfs from '@/storage/opfs';

const TRACK_TIMESLICE_MS = 10_000;

interface Session {
  id: string;
  tabStream: MediaStream;
  micStream: MediaStream | null;
  mixer: Mixer;
  scheduler: ChunkScheduler;
  trackRecorder: MediaRecorder | null;
  trackWriter: opfs.TrackWriter | null;
  chunkCount: number;
  writes: Promise<unknown>[];
  finishing: boolean;
}

let session: Session | null = null;

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isForOffscreen(message)) return false;
  handle(message).then(sendResponse, (error: unknown) => {
    sendResponse({ ok: false, error: toSessionError(error) } satisfies Ack);
  });
  return true;
});

async function handle(message: ToOffscreenMessage): Promise<Ack | AudioLevels> {
  switch (message.type) {
    case 'START_CAPTURE':
      await startCapture(message);
      return { ok: true };
    case 'STOP_CAPTURE':
      await finish();
      return { ok: true };
    case 'GET_LEVELS':
      return session ? session.mixer.levels() : { tab: 0, mic: 0 };
  }
}

async function startCapture(message: Extract<ToOffscreenMessage, { type: 'START_CAPTURE' }>): Promise<void> {
  if (session) throw new CaptureError('already-recording', 'Un enregistrement est déjà en cours');

  await opfs.pruneSessions(message.sessionId);

  const tabStream = await new TabCaptureStrategy().openStream(message.grant).catch((error: unknown) => {
    throw new CaptureError('capture-failed', describe(error));
  });

  let micStream: MediaStream | null = null;
  if (message.micEnabled) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      stopStream(tabStream);
      // L'offscreen document ne peut pas afficher de prompt : si l'autorisation
      // micro n'a jamais été accordée à l'extension, elle doit l'être depuis une
      // page d'extension (ui/mic-permission.html).
      throw new CaptureError('mic-permission', describe(error));
    }
  }

  const mixer = createMixer({ tab: tabStream, mic: micStream });
  const mimeType = pickMimeType();

  const current: Session = {
    id: message.sessionId,
    tabStream,
    micStream,
    mixer,
    scheduler: new ChunkScheduler({
      createRecorder: () => new MediaRecorder(mixer.stream, { mimeType }) as unknown as RecorderLike,
      mimeType,
      onChunk: (chunk, blob) => {
        const write = opfs
          .writeChunk(message.sessionId, chunk.index, blob)
          .then(() => {
            current.chunkCount += 1;
            notify({ target: 'sw', type: 'CHUNK_READY', index: chunk.index, start: chunk.start, end: chunk.end });
          })
          .catch((error: unknown) => {
            notify({ target: 'sw', type: 'CAPTURE_ERROR', error: toSessionError(error) });
          });
        current.writes.push(write);
      },
      onError: (error) => {
        notify({ target: 'sw', type: 'CAPTURE_ERROR', error: { code: 'capture-failed', message: error.message } });
      },
    }),
    trackRecorder: null,
    trackWriter: null,
    chunkCount: 0,
    writes: [],
    finishing: false,
  };

  if (message.keepFullTrack) {
    const writer = await opfs.openTrackWriter(message.sessionId);
    const recorder = new MediaRecorder(mixer.stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) current.writes.push(writer.write(event.data));
    };
    current.trackWriter = writer;
    current.trackRecorder = recorder;
    recorder.start(TRACK_TIMESLICE_MS);
  }

  // F-CAP-07 : onglet fermé ou navigation ailleurs — la piste s'arrête d'elle-même.
  const [track] = tabStream.getAudioTracks();
  if (track) track.addEventListener('ended', () => void finish());

  session = current;
  current.scheduler.start();
}

/** Arrêt propre : chunks vidés, flux relâchés, service worker prévenu. */
async function finish(): Promise<void> {
  const current = session;
  if (!current || current.finishing) return;
  current.finishing = true;

  const duration = await current.scheduler.stop();
  if (current.trackRecorder && current.trackRecorder.state !== 'inactive') {
    await new Promise<void>((resolve) => {
      current.trackRecorder?.addEventListener('stop', () => resolve(), { once: true });
      current.trackRecorder?.stop();
    });
  }
  await Promise.allSettled(current.writes);
  await current.trackWriter?.close();

  stopStream(current.tabStream);
  if (current.micStream) stopStream(current.micStream);
  await current.mixer.close();

  session = null;
  notify({ target: 'sw', type: 'RECORDING_STOPPED', duration, chunkCount: current.chunkCount });
}

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? 'audio/webm';
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function notify(message: ToWorkerMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // Service worker endormi : il relira l'état persisté à son réveil.
  });
}

class CaptureError extends Error {
  constructor(
    readonly code: SessionError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

function toSessionError(error: unknown): SessionError {
  if (error instanceof CaptureError) return { code: error.code, message: error.message };
  return { code: 'internal', message: describe(error) };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
