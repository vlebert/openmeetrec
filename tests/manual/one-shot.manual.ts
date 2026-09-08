/**
 * Sonde manuelle : la transcription en **une seule requête** (tout le fichier,
 * sans chunking) passe-t-elle chez le provider, et jusqu'à quelle durée ?
 *
 * C'est ce qui décide si on peut se passer de chunking pour une réunion, et donc
 * avoir des identités de speakers cohérentes sur tout le document (cf.
 * `shared/format.ts#hasGlobalSpeakers`). Pas un test de CI : réseau + payant,
 * lancé à la main comme `real-api.manual.ts`.
 *
 * L'audio doit être au format que produit `MediaRecorder` (webm « live », Segment
 * de taille inconnue, pas de Duration dans l'en-tête) — c'est précisément ce que
 * la sonde doit valider côté serveur :
 *
 *   ffmpeg -i source -vn -ac 1 -ar 48000 -c:a libopus -b:a 128k \
 *          -map_metadata -1 -f webm -live 1 sortie.webm
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@/config/config';
import { countSpeakers } from '@/audio/merge';
import { createProvider } from '@/providers/factory';
import { buildFilename, buildMarkdown } from '@/shared/format';
import { resolveCapabilities } from '@/providers/registry';
import type { Config, ProviderId } from '@/shared/types';

const run = promisify(execFile);

const audioPath = process.env['OMR_TEST_AUDIO'];
const provider = (process.env['OMR_TEST_PROVIDER'] ?? 'mistral') as Exclude<ProviderId, 'mock'>;
const apiKeyEnv = provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'custom' ? 'OMR_TEST_API_KEY' : 'MISTRAL_API_KEY';
const apiKey = process.env[apiKeyEnv];
const model = process.env['OMR_TEST_MODEL'];
// Par défaut on diarise : c'est tout l'intérêt du mode une-seule-requête.
const diarize = process.env['OMR_TEST_DIARIZE'] !== '0';

const canRun = Boolean(audioPath && apiKey);

/**
 * Durée réelle par décodage complet. Un webm de `MediaRecorder` n'annonce pas sa
 * durée (`ffprobe … format=duration` → N/A), donc on lit le dernier `time=` que
 * ffmpeg rapporte sur stderr.
 */
async function decodedDuration(path: string): Promise<number> {
  const { stderr } = await run('ffmpeg', ['-i', path, '-vn', '-sn', '-f', 'null', '-'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const times = [...stderr.matchAll(/time=(\d\d):(\d\d):(\d\d\.\d\d)/g)];
  const last = times.at(-1);
  if (!last) throw new Error(`impossible de déterminer la durée de ${path}`);
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
}

function hms(seconds: number): string {
  const t = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

describe.skipIf(!canRun)('transcription en une seule requête', () => {
  it(
    `envoie le fichier entier à ${provider}`,
    async () => {
      const outDir = new URL('../../test-results/', import.meta.url);
      await mkdir(outDir, { recursive: true });

      const bytes = (await stat(audioPath!)).size;
      const duration = await decodedDuration(audioPath!);
      console.log(
        `\n=== ${audioPath} ===\n` +
          `durée   : ${hms(duration)} (${duration.toFixed(1)} s)\n` +
          `taille  : ${(bytes / 1024 / 1024).toFixed(1)} MB\n` +
          `débit   : ${((bytes * 8) / duration / 1000).toFixed(0)} kbps\n` +
          `modèle  : ${model ?? 'défaut'} — diarize=${diarize}`,
      );

      const config: Config = {
        ...DEFAULT_CONFIG,
        provider: provider === 'custom' ? 'custom' : provider,
        model: model ?? (provider === 'openai' ? 'whisper-1' : 'voxtral-mini-latest'),
        apiKeys: { [provider]: apiKey! },
        diarize,
        downloadAudio: false,
        language: null,
        ...(process.env['OMR_TEST_ENDPOINT']
          ? {
              customEndpoint: process.env['OMR_TEST_ENDPOINT'],
              customSupportsSegments: true,
              customSupportsDiarization: diarize,
            }
          : {}),
      };
      const capabilities = resolveCapabilities(config);
      const transcriber = createProvider(config);

      const blob = new Blob([await readFile(audioPath!)], { type: 'audio/webm' });
      const startedAt = Date.now();

      let result;
      try {
        result = await transcriber.transcribe(blob, {
          model: config.model,
          language: config.language,
          diarize: capabilities.diarize,
        });
      } catch (error) {
        // Un refus est un résultat, pas un incident : c'est lui qui donne la
        // limite réelle. On le rapporte tel quel plutôt que de le masquer.
        const elapsed = (Date.now() - startedAt) / 1000;
        console.log(`\nVERDICT : REFUSÉ après ${elapsed.toFixed(1)} s\n${String(error)}\n`);
        throw error;
      }

      const elapsed = (Date.now() - startedAt) / 1000;
      const segments = result.segments ?? [];
      const covered = segments.at(-1)?.end ?? 0;
      const speakers = countSpeakers(segments);

      console.log(
        `\nVERDICT : ACCEPTÉ en ${elapsed.toFixed(1)} s (${(duration / elapsed).toFixed(1)}× temps réel)\n` +
          `segments : ${segments.length}\n` +
          `speakers : ${speakers}\n` +
          `couvert  : ${hms(covered)} / ${hms(duration)} (${((covered / duration) * 100).toFixed(1)} %)\n` +
          `texte    : ${result.text.length} caractères\n`,
      );

      expect(segments.length).toBeGreaterThan(0);
      // Le piège : une API peut accepter un fichier trop long et n'en transcrire
      // que le début, sans erreur. On exige que la couverture aille au bout.
      expect(covered).toBeGreaterThan(duration * 0.98);

      const doc = {
        meta: {
          provider,
          model: config.model,
          date: new Date().toISOString(),
          duration,
          platform: 'one-shot-probe',
          extensionVersion: 'manual-test',
        },
        segments,
        text: result.text,
        diarized: capabilities.diarize,
        chunkCount: 1,
        failedChunks: [],
        hadSegments: segments.length > 0,
        // Une seule requête : aucune couture, donc les speakers sont nommés.
        chunkBoundaries: [],
      };
      const filename = buildFilename(doc.meta, 'md').replace('openmeetrec_', `one-shot_${provider}_`);
      const resultPath = fileURLToPath(new URL(filename, outDir));
      await writeFile(resultPath, buildMarkdown(doc), 'utf-8');
      console.log(`résultat écrit dans ${resultPath}`);
    },
    30 * 60 * 1000,
  );
});

if (!canRun) {
  console.log(
    `[one-shot.manual] ignoré : définis OMR_TEST_AUDIO (chemin du webm) et ${apiKeyEnv} pour lancer cette sonde.`,
  );
}
