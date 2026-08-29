/**
 * Faux endpoint de transcription, servi en local pendant le test.
 *
 * Règle projet : aucun test ne touche le réseau ni une clé API réelle. Ce
 * serveur remplit deux rôles — répondre des segments plausibles, et enregistrer
 * ce que l'extension a réellement envoyé, ce qu'aucune assertion côté navigateur
 * ne pourrait vérifier.
 */

import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';

/** Débit approximatif du webm/opus produit par MediaRecorder, pour estimer la durée d'un chunk. */
const BYTES_PER_SECOND = 16_100;
const SEGMENT_SECONDS = 5;

export interface RecordedCall {
  /** Ordre d'arrivée, pas index de chunk : les chunks partent en parallèle. */
  order: number;
  path: string;
  bytes: number;
  /** Noms des champs du multipart, dans l'ordre. */
  fields: string[];
  authorization: string | undefined;
  /** Statut HTTP effectivement renvoyé — utile pour distinguer tentatives ratées et réussies. */
  status: number;
}

export interface MockApi {
  url: string;
  calls: RecordedCall[];
  /** Fait échouer toutes les prochaines transcriptions avec ce statut, jusqu'à `setFailing(null)`. */
  setFailing(status: number | null): void;
  close(): Promise<void>;
}

export async function startMockApi(meetingPagePath: string): Promise<MockApi> {
  const calls: RecordedCall[] = [];
  let failStatus: number | null = null;

  const server: Server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (chunk: Buffer) => parts.push(chunk));
    req.on('end', () => {
      const url = req.url ?? '/';

      if (req.method === 'GET' && url.startsWith('/meeting')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(readFileSync(meetingPagePath));
        return;
      }

      if (req.method !== 'POST') {
        // Utilisé par « tester la clé ».
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'mock-1' }] }));
        return;
      }

      const body = Buffer.concat(parts);
      const raw = body.toString('latin1');
      const status = failStatus ?? 200;
      calls.push({
        order: calls.length,
        path: url,
        bytes: body.length,
        fields: [...raw.matchAll(/name="([^"]+)"/g)].map((m) => m[1] ?? ''),
        authorization: req.headers['authorization'],
        status,
      });

      if (failStatus !== null) {
        res.writeHead(failStatus, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'mock failure' }));
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(transcriptionFor(body.length)));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    url: `http://localhost:${port}`,
    calls,
    setFailing: (status) => {
      failStatus = status;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/**
 * Segments bornés par la durée réelle du chunk, estimée depuis la taille du
 * webm. Un provider qui renverrait des timestamps hors de son propre chunk
 * produirait un transcript incohérent : ce mock ne triche pas là-dessus.
 */
function transcriptionFor(bytes: number): unknown {
  const seconds = Math.max(1, Math.round(bytes / BYTES_PER_SECOND));
  const count = Math.max(1, Math.floor(seconds / SEGMENT_SECONDS));
  const segments = Array.from({ length: count }, (_, i) => ({
    text: `segment ${i * SEGMENT_SECONDS}`,
    start: i * SEGMENT_SECONDS,
    end: Math.min((i + 1) * SEGMENT_SECONDS, seconds),
    speaker_id: i % 2,
  }));
  return { text: segments.map((s) => s.text).join(' '), segments };
}
