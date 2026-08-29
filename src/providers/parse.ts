/**
 * Lecture des réponses de transcription. Module PUR.
 *
 * Mistral et OpenAI renvoient la même forme générale (`{ text, segments[] }`)
 * avec des variantes sur le nom du champ locuteur, d'où un parsing défensif
 * plutôt qu'un type par provider : ces réponses viennent du réseau, rien ne
 * garantit leur forme.
 */

import type { Segment, TranscriptionResult } from '@/shared/types';

export function parseTranscription(payload: unknown): TranscriptionResult {
  const root = asRecord(payload);
  if (!root) throw new Error('unreadable transcription response');

  const segments = parseSegments(root['segments']);
  const text = typeof root['text'] === 'string' ? root['text'] : segmentsText(segments);

  if (segments.length === 0) return { text };
  return { text, segments };
}

function parseSegments(value: unknown): Segment[] {
  if (!Array.isArray(value)) return [];
  const segments: Segment[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const start = asNumber(record['start']);
    const end = asNumber(record['end']);
    const text = typeof record['text'] === 'string' ? record['text'].trim() : '';
    if (start === null || end === null || text === '') continue;
    const speakerId = parseSpeaker(record);
    segments.push(speakerId === undefined ? { text, start, end } : { text, start, end, speakerId });
  }
  return segments;
}

/** `speaker_id` chez Mistral, `speaker` ailleurs ; l'identifiant peut être un nombre. */
function parseSpeaker(record: Record<string, unknown>): string | undefined {
  const raw = record['speaker_id'] ?? record['speaker'];
  if (typeof raw === 'string' && raw !== '') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return undefined;
}

function segmentsText(segments: readonly Segment[]): string {
  return segments.map((seg) => seg.text).join(' ').trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
