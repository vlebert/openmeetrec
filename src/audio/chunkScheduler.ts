/**
 * Production des chunks *pendant* l'enregistrement (F-AUD-03).
 *
 * Deux MediaRecorder décalés tournent en permanence : le recorder d'indice `i`
 * démarre à `i·step` et s'arrête `chunkDuration` plus tard, si bien que la fin
 * du chunk `i` recouvre le début du chunk `i+1` de `overlap` secondes. Chaque
 * recorder produit un conteneur webm autonome, décodable seul par l'API de
 * transcription — c'est ce qui évite de garder l'enregistrement entier en
 * mémoire (architecture §4).
 *
 * Les bornes des chunks viennent de `chunking.ts` (module pur) et pas d'une
 * mesure de temps : le planificateur et le merge partagent ainsi exactement la
 * même arithmétique.
 */

import { DEFAULT_CHUNK_OPTIONS, assertValidChunkOptions, chunkStartTime, chunkStep, isChunkNeeded } from '@/audio/chunking';
import type { ChunkInfo, ChunkOptions } from '@/shared/types';

/** Sous-ensemble de MediaRecorder utilisé ici, pour pouvoir le simuler en test. */
export interface RecorderLike {
  readonly state: string;
  start(timeslice?: number): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface ChunkSchedulerDeps {
  createRecorder(): RecorderLike;
  /** Appelé une fois par chunk complet, dans l'ordre de fin d'enregistrement. */
  onChunk(chunk: ChunkInfo, blob: Blob): void;
  onError?(error: Error): void;
  opts?: ChunkOptions;
  mimeType?: string;
  /** Injectés pour les tests (timers factices). */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
}

interface LiveChunk {
  index: number;
  start: number;
  end: number;
  parts: Blob[];
  recorder: RecorderLike;
  settle: () => void;
}

export class ChunkScheduler {
  private readonly opts: ChunkOptions;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => number;
  private readonly clearTimer: (id: number) => void;
  private readonly timers = new Set<number>();
  private readonly live = new Map<number, LiveChunk>();
  private readonly pending = new Set<Promise<void>>();
  private startedAt = 0;
  private started = false;
  private running = false;

  constructor(private readonly deps: ChunkSchedulerDeps) {
    this.opts = deps.opts ?? DEFAULT_CHUNK_OPTIONS;
    assertValidChunkOptions(this.opts);
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
    this.clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id));
  }

  /** Secondes écoulées depuis le début de l'enregistrement. */
  elapsed(): number {
    return this.started ? (this.now() - this.startedAt) / 1000 : 0;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.started = true;
    this.startedAt = this.now();
    this.launch(0);
  }

  /**
   * Arrête tout et attend l'écriture des chunks en cours. Le dernier chunk est
   * abandonné s'il est entièrement contenu dans le précédent (`isChunkNeeded`) :
   * transcrire à nouveau les mêmes secondes ne ferait qu'ajouter des doublons.
   */
  async stop(): Promise<number> {
    if (!this.running) return this.elapsed();
    this.running = false;
    for (const id of this.timers) this.clearTimer(id);
    this.timers.clear();

    const total = this.elapsed();
    for (const chunk of this.live.values()) {
      chunk.end = Math.min(chunk.end, total);
      if (chunk.recorder.state !== 'inactive') chunk.recorder.stop();
    }
    await Promise.all([...this.pending]);
    return total;
  }

  private launch(index: number): void {
    if (!this.running) return;

    const start = chunkStartTime(index, this.opts);
    const recorder = this.deps.createRecorder();
    let settle = (): void => {};
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    this.pending.add(done);
    void done.finally(() => this.pending.delete(done));

    const chunk: LiveChunk = {
      index,
      start,
      end: start + this.opts.chunkDuration,
      parts: [],
      recorder,
      settle,
    };
    this.live.set(index, chunk);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunk.parts.push(event.data);
    };
    recorder.onstop = () => {
      this.live.delete(index);
      this.emit(chunk);
      chunk.settle();
    };
    recorder.onerror = () => {
      this.live.delete(index);
      this.deps.onError?.(new Error(`chunk ${index} recorder failed`));
      chunk.settle();
    };

    try {
      recorder.start();
    } catch (error) {
      this.live.delete(index);
      this.deps.onError?.(error instanceof Error ? error : new Error(String(error)));
      chunk.settle();
      return;
    }

    this.schedule(this.opts.chunkDuration * 1000, () => {
      if (recorder.state !== 'inactive') recorder.stop();
    });
    this.schedule(chunkStep(this.opts) * 1000, () => this.launch(index + 1));
  }

  private emit(chunk: LiveChunk): void {
    const duration = chunk.end;
    if (!isChunkNeeded(chunk.index, duration, this.opts)) return;
    if (chunk.end - chunk.start <= 0) return;
    const blob = new Blob(chunk.parts, { type: this.deps.mimeType ?? 'audio/webm' });
    if (blob.size === 0) return;
    this.deps.onChunk({ index: chunk.index, start: chunk.start, end: chunk.end }, blob);
  }

  private schedule(delayMs: number, fn: () => void): void {
    const id = this.setTimer(() => {
      this.timers.delete(id);
      fn();
    }, delayMs);
    this.timers.add(id);
  }
}
