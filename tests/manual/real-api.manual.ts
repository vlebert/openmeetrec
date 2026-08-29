/**
 * Validation manuelle contre une vraie API de transcription. PAS un test de CI :
 * lancé à la main via `npm run test:real-api`, jamais par `npm test`.
 *
 * Découpe un fichier audio réel en chunks (mêmes bornes que `audio/chunking.ts`)
 * avec `ffmpeg`, les envoie au vrai provider, puis écrit le markdown obtenu dans
 * `test-results/` pour relecture humaine — voir `README.md#valider-avec-une-vraie-api`.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { DEFAULT_CHUNK_OPTIONS, planChunks } from '@/audio/chunking';
import { chunkBoundaries } from '@/audio/merge';
import { createProvider } from '@/providers/factory';
import { runTranscription } from '@/pipeline/pipeline';
import { buildFilename, buildMarkdown } from '@/shared/format';
import type { Config, ProviderId } from '@/shared/types';

const run = promisify(execFile);

const audioPath = process.env['OMR_TEST_AUDIO'];
const provider = (process.env['OMR_TEST_PROVIDER'] ?? 'mistral') as Exclude<ProviderId, 'mock' | 'custom'> | 'custom';
const apiKeyEnv = provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'custom' ? 'OMR_TEST_API_KEY' : 'MISTRAL_API_KEY';
const apiKey = process.env[apiKeyEnv];

const chunkDuration = Number(process.env['OMR_TEST_CHUNK_DURATION'] ?? DEFAULT_CHUNK_OPTIONS.chunkDuration);
const overlap = Number(process.env['OMR_TEST_OVERLAP'] ?? DEFAULT_CHUNK_OPTIONS.overlap);
const diarize = process.env['OMR_TEST_DIARIZE'] === '1';
const model = process.env['OMR_TEST_MODEL'];

const canRun = Boolean(audioPath && apiKey);

describe.skipIf(!canRun)('validation réelle', () => {
  it(
    `transcrit un fichier réel via ${provider}`,
    async () => {
      const outDir = new URL('../../test-results/', import.meta.url);
      await mkdir(outDir, { recursive: true });

      const { stdout } = await run('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        audioPath!,
      ]);
      const duration = Number(stdout.trim());
      expect(duration).toBeGreaterThan(0);

      const chunks = planChunks(duration, { chunkDuration, overlap });
      expect(chunks.length).toBeGreaterThan(0);

      const chunkPaths = new Map<number, string>();
      for (const chunk of chunks) {
        const chunkPath = fileURLToPath(new URL(`chunk-${provider}-${chunk.index}.webm`, outDir));
        await run('ffmpeg', [
          '-y',
          '-i',
          audioPath!,
          '-ss',
          String(chunk.start),
          '-t',
          String(chunk.end - chunk.start),
          '-c:a',
          'libopus',
          chunkPath,
        ]);
        chunkPaths.set(chunk.index, chunkPath);
      }

      const customEndpoint = process.env['OMR_TEST_ENDPOINT'];
      const config: Config = {
        provider: provider === 'custom' ? 'custom' : provider,
        model: model ?? (provider === 'openai' ? 'whisper-1' : 'voxtral-mini-latest'),
        apiKeys: { [provider]: apiKey! },
        diarize,
        downloadAudio: false,
        language: null,
        ...(provider === 'custom' && customEndpoint
          ? { customEndpoint, customSupportsSegments: true, customSupportsDiarization: diarize }
          : {}),
      };
      const transcriptionProvider = createProvider(config);

      const outcome = await runTranscription({
        chunks,
        loadChunk: async (chunk) => {
          const path = chunkPaths.get(chunk.index);
          if (!path) throw new Error(`chunk introuvable : ${chunk.index}`);
          const buffer = await readFile(path);
          return new Blob([buffer], { type: 'audio/webm' });
        },
        provider: transcriptionProvider,
        opts: { model: config.model, language: config.language, diarize },
        onProgress: (done, total) => {
          console.log(`[${provider}] chunk ${done}/${total}`);
        },
      });

      console.log(`transcrit: ${outcome.transcribedCount}/${chunks.length}, échecs: ${outcome.failedChunks.join(', ') || 'aucun'}`);
      expect(outcome.transcribedCount).toBeGreaterThan(0);

      const doc = {
        meta: {
          provider,
          model: config.model,
          date: new Date().toISOString(),
          duration,
          platform: 'manual-test',
          extensionVersion: 'manual-test',
        },
        segments: outcome.segments,
        text: outcome.text,
        diarized: diarize && transcriptionProvider.supportsDiarization,
        chunkCount: chunks.length,
        failedChunks: outcome.failedChunks,
        hadSegments: outcome.hadSegments,
        chunkBoundaries: chunkBoundaries(chunks),
      };
      const markdown = buildMarkdown(doc);
      const filename = buildFilename(doc.meta, 'md').replace('openmeetrec_', `real-api_${provider}_`);
      const resultPath = fileURLToPath(new URL(filename, outDir));
      await writeFile(resultPath, markdown, 'utf-8');
      console.log(`résultat écrit dans ${resultPath}`);
    },
  );
});

if (!canRun) {
  console.log(
    `[real-api.manual] ignoré : définis OMR_TEST_AUDIO (chemin du fichier audio) et ${apiKeyEnv} pour lancer ce test.`,
  );
}
