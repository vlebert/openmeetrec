/**
 * Mix micro + onglet en un flux mono (F-CAP-04), avec ré-injection du son de
 * l'onglet vers les enceintes (F-CAP-06).
 *
 * `chrome.tabCapture` *détourne* le son de l'onglet : tant que la capture est
 * active, l'utilisateur n'entend plus sa visio. Il faut donc renvoyer
 * explicitement la source onglet vers `ctx.destination`. Le micro, lui, n'y est
 * jamais reconnecté — ce serait un larsen immédiat.
 */

export interface MixerSources {
  tab: MediaStream;
  /** `null` si l'utilisateur enregistre sans micro. */
  mic: MediaStream | null;
}

export interface AudioLevelsSnapshot {
  tab: number;
  mic: number;
}

export interface Mixer {
  /** Flux mono à donner au MediaRecorder. */
  readonly stream: MediaStream;
  /** Niveaux RMS normalisés 0..1, pour les meters du popup. */
  levels(): AudioLevelsSnapshot;
  close(): Promise<void>;
}

interface Meter {
  analyser: AnalyserNode;
  buffer: Uint8Array<ArrayBuffer>;
}

export function createMixer(sources: MixerSources): Mixer {
  const ctx = new AudioContext();
  const destination = ctx.createMediaStreamDestination();
  destination.channelCount = 1;
  destination.channelCountMode = 'explicit';
  destination.channelInterpretation = 'speakers';

  const tabSource = ctx.createMediaStreamSource(sources.tab);
  const tabMeter = attach(ctx, tabSource, destination);
  // Ré-injection : sans ça, la visio devient muette pour l'utilisateur.
  tabSource.connect(ctx.destination);

  const micMeter = sources.mic ? attach(ctx, ctx.createMediaStreamSource(sources.mic), destination) : null;

  return {
    stream: destination.stream,
    levels: () => ({ tab: rms(tabMeter), mic: micMeter ? rms(micMeter) : 0 }),
    close: async () => {
      await ctx.close();
    },
  };
}

function attach(ctx: AudioContext, source: MediaStreamAudioSourceNode, destination: AudioNode): Meter {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  source.connect(destination);
  return { analyser, buffer: new Uint8Array(new ArrayBuffer(analyser.fftSize)) };
}

function rms(meter: Meter): number {
  meter.analyser.getByteTimeDomainData(meter.buffer);
  let sum = 0;
  for (const sample of meter.buffer) {
    const centered = (sample - 128) / 128;
    sum += centered * centered;
  }
  return Math.min(1, Math.sqrt(sum / meter.buffer.length));
}
