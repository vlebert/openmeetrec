import { describe, expect, it } from 'vitest';

import { ChunkScheduler, type RecorderLike } from '@/audio/chunkScheduler';
import type { ChunkInfo } from '@/shared/types';

/**
 * Horloge virtuelle : le scheduler reçoit ses timers par injection, on peut donc
 * simuler une réunion d'une heure sans attendre.
 */
class Clock {
  time = 0;
  private tasks = new Map<number, { at: number; fn: () => void }>();
  private nextId = 1;

  now = (): number => this.time;
  setTimer = (fn: () => void, ms: number): number => {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.time + ms, fn });
    return id;
  };
  clearTimer = (id: number): void => {
    this.tasks.delete(id);
  };

  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    for (;;) {
      let due: [number, { at: number; fn: () => void }] | null = null;
      for (const entry of this.tasks) {
        if (entry[1].at <= target && (due === null || entry[1].at < due[1].at)) due = entry;
      }
      if (!due) break;
      this.tasks.delete(due[0]);
      this.time = due[1].at;
      due[1].fn();
      await Promise.resolve();
    }
    this.time = target;
  }
}

class FakeRecorder implements RecorderLike {
  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(private readonly live: { count: number; peak: number }) {}

  start(): void {
    this.state = 'recording';
    this.live.count += 1;
    this.live.peak = Math.max(this.live.peak, this.live.count);
  }

  stop(): void {
    this.state = 'inactive';
    this.live.count -= 1;
    this.ondataavailable?.({ data: new Blob(['x']) });
    this.onstop?.();
  }
}

function setup() {
  const clock = new Clock();
  const live = { count: 0, peak: 0 };
  const chunks: ChunkInfo[] = [];
  const scheduler = new ChunkScheduler({
    createRecorder: () => new FakeRecorder(live),
    onChunk: (chunk) => chunks.push(chunk),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { clock, live, chunks, scheduler };
}

describe('ChunkScheduler', () => {
  it('produit des chunks de 5 min qui se recouvrent de 30 s', async () => {
    const { clock, chunks, scheduler } = setup();
    scheduler.start();
    await clock.advance(1000 * 1000);
    const total = await scheduler.stop();

    expect(total).toBe(1000);
    expect(chunks).toEqual([
      { index: 0, start: 0, end: 300 },
      { index: 1, start: 270, end: 570 },
      { index: 2, start: 540, end: 840 },
      { index: 3, start: 810, end: 1000 },
    ]);
  });

  it('ne garde jamais plus de deux recorders en vol', async () => {
    const { clock, live, scheduler } = setup();
    scheduler.start();
    await clock.advance(3600 * 1000);
    await scheduler.stop();

    expect(live.peak).toBe(2);
    expect(live.count).toBe(0);
  });

  // Le stop tombe dans la zone d'overlap : le chunk [270, 280] est entièrement
  // contenu dans le premier, le transcrire ne ferait que des doublons.
  it('écarte le dernier chunk quand il est déjà couvert par le précédent', async () => {
    const { clock, chunks, scheduler } = setup();
    scheduler.start();
    await clock.advance(280 * 1000);
    await scheduler.stop();

    expect(chunks).toEqual([{ index: 0, start: 0, end: 280 }]);
  });

  it('libère tous les recorders même si le stop arrive avant le premier chunk', async () => {
    const { clock, live, chunks, scheduler } = setup();
    scheduler.start();
    await clock.advance(42 * 1000);
    const total = await scheduler.stop();

    expect(total).toBe(42);
    expect(live.count).toBe(0);
    expect(chunks).toEqual([{ index: 0, start: 0, end: 42 }]);
  });
});
