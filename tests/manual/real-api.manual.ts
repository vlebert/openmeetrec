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
import { DEFAULT_CONFIG } from '@/config/config';
import { chunkBoundaries } from '@/audio/merge';
import { createProvider } from '@/providers/factory';
import { runTranscription } from '@/pipeline/pipeline';
import { buildFilename, buildMarkdown } from '@/shared/format';
import type { TranscriptionProvider } from '@/providers/base';
import type { ChunkInfo, Config, ProviderId, TranscriptionResult } from '@/shared/types';

/** Tolérance sur les bornes attendues des timestamps, pour l'arrondi de l'encodage. */
const TIMESTAMP_TOLERANCE_S = 2;

/**
 * Un provider réel n'est censé renvoyer que des timestamps relatifs à l'audio du
 * chunk qu'on lui a soumis (0..durée du chunk) : c'est l'hypothèse sur laquelle
 * `adjustTimestamps`/`mergeSegments` s'appuient pour recoller les chunks (cf.
 * limite connue dans le README — jamais vérifiée contre une vraie réponse).
 * Cette fonction échoue fort si un provider ne respecte pas ce contrat, plutôt
 * que de laisser passer silencieusement un transcript incohérent.
 */
function assertSegmentFormat(chunk: ChunkInfo, result: TranscriptionResult, expectSegments: boolean): void {
  if (!expectSegments) return;
  const chunkAudioDuration = chunk.end - chunk.start;
  // Un chunk sans parole (silence) renvoie légitimement `segments: []` (constaté
  // avec Voxtral) : le pipeline le traite désormais comme une contribution nulle
  // plutôt que comme une erreur (cf. pipeline.ts), donc ce n'est pas non plus une
  // erreur ici.
  if (!result.segments) return;
  for (const seg of result.segments) {
    if (typeof seg.text !== 'string' || seg.text.trim().length === 0) {
      throw new Error(`chunk ${chunk.index} : segment sans texte (${JSON.stringify(seg)})`);
    }
    if (!Number.isFinite(seg.start) || !Number.isFinite(seg.end)) {
      throw new Error(`chunk ${chunk.index} : timestamps non numériques (${JSON.stringify(seg)})`);
    }
    if (seg.end <= seg.start) {
      throw new Error(`chunk ${chunk.index} : end <= start (${JSON.stringify(seg)})`);
    }
    if (seg.start < -TIMESTAMP_TOLERANCE_S || seg.end > chunkAudioDuration + TIMESTAMP_TOLERANCE_S) {
      throw new Error(
        `chunk ${chunk.index} : timestamp [${seg.start}, ${seg.end}] hors des bornes attendues ` +
          `[0, ${chunkAudioDuration}] — le provider renvoie peut-être des timestamps absolus ou dans une autre unité.`,
      );
    }
  }
}

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

      // Un webm produit en direct par MediaRecorder n'a pas de Cues/Duration dans son
      // en-tête (`ffprobe -show_entries format=duration` renvoie N/A) : on décode le
      // flux en entier et on lit le dernier `time=` que ffmpeg rapporte sur stderr.
      const { stderr: decodeLog } = await run(
        'ffmpeg',
        ['-i', audioPath!, '-vn', '-sn', '-f', 'null', '-'],
        { maxBuffer: 32 * 1024 * 1024 },
      );
      const times = [...decodeLog.matchAll(/time=(\d\d):(\d\d):(\d\d\.\d\d)/g)];
      const lastTime = times.at(-1);
      if (!lastTime) throw new Error(`impossible de déterminer la durée de ${audioPath}`);
      const duration = Number(lastTime[1]) * 3600 + Number(lastTime[2]) * 60 + Number(lastTime[3]);
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
        // Les réglages hors pipeline (rappel de réunion…) restent aux défauts :
        // ce script ne valide que la transcription.
        ...DEFAULT_CONFIG,
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

      // Chaque blob de chunk est unique (lu une seule fois depuis son propre
      // fichier) : on peut donc retrouver l'index du chunk à partir du Blob que
      // `transcribe` reçoit, et inspecter la réponse brute sans faire un second
      // appel réseau.
      const chunkIndexByBlob = new Map<Blob, number>();
      const rawResultByChunk = new Map<number, TranscriptionResult>();
      const inspectingProvider: TranscriptionProvider = {
        id: transcriptionProvider.id,
        supportsSegments: transcriptionProvider.supportsSegments,
        supportsDiarization: transcriptionProvider.supportsDiarization,
        testKey: () => transcriptionProvider.testKey(),
        transcribe: async (audio, opts) => {
          const result = await transcriptionProvider.transcribe(audio, opts);
          const index = chunkIndexByBlob.get(audio);
          if (index !== undefined) rawResultByChunk.set(index, result);
          return result;
        },
      };

      const outcome = await runTranscription({
        chunks,
        loadChunk: async (chunk) => {
          const path = chunkPaths.get(chunk.index);
          if (!path) throw new Error(`chunk introuvable : ${chunk.index}`);
          const buffer = await readFile(path);
          const blob = new Blob([buffer], { type: 'audio/webm' });
          chunkIndexByBlob.set(blob, chunk.index);
          return blob;
        },
        provider: inspectingProvider,
        opts: { model: config.model, language: config.language, diarize },
        onProgress: (done, total) => {
          console.log(`[${provider}] chunk ${done}/${total}`);
        },
      });

      console.log(`transcrit: ${outcome.transcribedCount}/${chunks.length}, échecs: ${outcome.failedChunks.join(', ') || 'aucun'}`);
      expect(outcome.transcribedCount).toBeGreaterThan(0);

      // Le format et les timestamps de la vraie réponse correspondent-ils à ce que
      // `audio/merge.ts` suppose ? Un provider qui dérape ici casserait le
      // réassemblage des chunks en silence (cf. « Limites connues » du README).
      for (const chunk of chunks) {
        if (outcome.failedChunks.includes(chunk.index)) continue;
        const raw = rawResultByChunk.get(chunk.index);
        if (!raw) throw new Error(`chunk ${chunk.index} : aucune réponse brute capturée`);
        assertSegmentFormat(chunk, raw, transcriptionProvider.supportsSegments);
      }

      // Sanity check du réassemblage sur des données réelles : la logique de merge
      // elle-même est déjà couverte par tests/unit/merge.test.ts et
      // tests/unit/pipeline.test.ts avec des données synthétiques ; ceci vérifie
      // juste qu'elle tient face à de vrais timestamps.
      for (let i = 1; i < outcome.segments.length; i += 1) {
        expect(outcome.segments[i]!.start).toBeGreaterThanOrEqual(outcome.segments[i - 1]!.start);
      }

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
