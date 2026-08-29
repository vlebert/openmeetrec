import { describe, expect, it } from 'vitest';
import { MockProvider } from '@/providers/mock';

const blob = (bytes: number) => new Blob([new Uint8Array(bytes)]);

describe('MockProvider', () => {
  it('est déterministe pour une même entrée', async () => {
    const provider = new MockProvider();
    const opts = { model: 'mock', diarize: false };
    const a = await provider.transcribe(blob(3072), opts);
    const b = await provider.transcribe(blob(3072), opts);
    expect(a).toEqual(b);
  });

  it('n ajoute des speakers que si la diarization est demandée', async () => {
    const provider = new MockProvider();
    const plain = await provider.transcribe(blob(2048), { model: 'mock', diarize: false });
    expect(plain.segments!.every((s) => s.speakerId === undefined)).toBe(true);

    const diarized = await provider.transcribe(blob(2048), { model: 'mock', diarize: true });
    expect(diarized.segments!.every((s) => s.speakerId !== undefined)).toBe(true);
  });

  it('produit des segments contigus et croissants', async () => {
    const provider = new MockProvider();
    const { segments } = await provider.transcribe(blob(5120), { model: 'mock', diarize: false });
    for (let i = 1; i < segments!.length; i += 1) {
      expect(segments![i]!.start).toBe(segments![i - 1]!.end);
    }
  });

  it('sait simuler un provider sans segments', async () => {
    const provider = new MockProvider({ segmentsDisabled: true });
    expect(provider.supportsSegments).toBe(false);
    const result = await provider.transcribe(blob(2048), { model: 'mock', diarize: false });
    expect(result.segments).toBeUndefined();
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('compte les appels reçus', async () => {
    const provider = new MockProvider();
    await provider.transcribe(blob(1024), { model: 'mock', diarize: false });
    await provider.transcribe(blob(1024), { model: 'mock', diarize: false });
    expect(provider.calls).toBe(2);
  });

  it('valide toujours la clé, sans réseau', async () => {
    expect(await new MockProvider().testKey()).toBe(true);
  });
});
