/**
 * Génération du markdown exporté. Module PUR.
 *
 * Format : frontmatter YAML + transcription en markdown simple (PRD §7).
 */

import type { Segment, SessionMeta } from '@/shared/types';
import { countSpeakers } from '@/audio/merge';

export interface TranscriptDocument {
  meta: SessionMeta;
  /** Segments fusionnés, timestamps absolus. Vide si on est en mode texte brut. */
  segments?: Segment[];
  /** Texte continu, utilisé quand il n'y a pas de segments. */
  text?: string;
  /** Diarization effectivement appliquée. */
  diarized: boolean;
  /** Nombre de chunks transcrits, pour les avertissements. */
  chunkCount: number;
  /** Chunks dont la transcription a échoué définitivement. */
  failedChunks?: number[];
  /** Le provider renvoyait-il des segments horodatés ? */
  hadSegments: boolean;
  /** Bornes de chunk (`audio/merge#chunkBoundaries`), pour les sections de l'export. */
  chunkBoundaries?: number[];
}

/** `HH:MM:SS` à partir d'un nombre de secondes. */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

/** `0` → `Speaker 0` ; un identifiant déjà lisible est laissé tel quel. */
export function formatSpeaker(speakerId: string | undefined): string {
  if (speakerId === undefined || speakerId === '') return 'Speaker ?';
  return /^\d+$/.test(speakerId) ? `Speaker ${speakerId}` : speakerId;
}

function escapeYamlValue(value: string): string {
  // Les valeurs qui contiennent des caractères YAML significatifs sont citées.
  return /[:#\n"']/.test(value) ? JSON.stringify(value) : value;
}

export function buildFrontmatter(doc: TranscriptDocument): string {
  const { meta } = doc;
  const lines = [
    `model: ${escapeYamlValue(meta.model)}`,
    `provider: ${escapeYamlValue(meta.provider)}`,
    `date: ${escapeYamlValue(meta.date)}`,
    `duration: ${Math.round(meta.duration)}`,
    `platform: ${escapeYamlValue(meta.platform)}`,
  ];
  if (doc.diarized && doc.segments) {
    lines.push(`speakers: ${countSpeakers(doc.segments)}`);
  }
  lines.push(`extension_version: ${escapeYamlValue(meta.extensionVersion)}`);
  return `---\n${lines.join('\n')}\n---`;
}

/**
 * Avertissements portés par le document.
 *
 * Ils existent parce que deux limitations connues sont invisibles dans le texte
 * final : les doublons de la concaténation sans timestamps, et le fait que les
 * identités de speakers ne sont pas appariées d'un chunk à l'autre.
 */
export function buildWarnings(doc: TranscriptDocument): string[] {
  const warnings: string[] = [];

  if (!doc.hadSegments && doc.chunkCount > 1) {
    warnings.push(
      'The model in use does not return timestamps: chunks were concatenated as-is, ' +
        'text in overlapping zones may appear duplicated.',
    );
  }
  if (doc.diarized && doc.chunkCount > 1) {
    warnings.push(
      'Speaker identities are assigned independently for each chunk: ' +
        '"Speaker 0" in one chunk is not necessarily the same person as in the next.',
    );
  }
  const failed = doc.failedChunks ?? [];
  if (failed.length > 0) {
    warnings.push(
      `Transcription failed for ${failed.length} chunk(s) (${failed.join(', ')}): ` +
        'the corresponding passages are missing.',
    );
  }

  return warnings;
}

export function buildBody(doc: TranscriptDocument): string {
  if (doc.diarized && doc.segments && doc.segments.length > 0) {
    const boundaries = doc.chunkBoundaries ?? [];
    const lines: string[] = [];
    let chunkNumber = 1;
    if (boundaries.length > 0) lines.push(`**Chunk ${chunkNumber}**`);
    doc.segments.forEach((seg) => {
      while (chunkNumber - 1 < boundaries.length && seg.start >= boundaries[chunkNumber - 1]!) {
        chunkNumber += 1;
        if (lines.length > 0) lines.push('');
        lines.push(`**Chunk ${chunkNumber}**`);
      }
      if (lines.length > 0) lines.push('');
      lines.push(`**${formatSpeaker(seg.speakerId)}** (${formatTimestamp(seg.start)}): ${seg.text.trim()}`);
    });
    return lines.join('\n');
  }

  const text =
    doc.text ??
    (doc.segments ?? [])
      .map((s) => s.text.trim())
      .filter(Boolean)
      .join(' ');

  return text.trim();
}

export function buildMarkdown(doc: TranscriptDocument): string {
  const parts = [buildFrontmatter(doc)];

  const warnings = buildWarnings(doc);
  if (warnings.length > 0) {
    parts.push(['**Notes**', '', ...warnings.map((w) => `- ${w}`)].join('\n'));
  }

  parts.push(buildBody(doc));
  return `${parts.join('\n\n')}\n`;
}

/** Nom de fichier stable et sans caractères problématiques. */
export function buildFilename(meta: SessionMeta, extension: string): string {
  const stamp = meta.date.replace(/[:]/g, '-').replace(/\..*$/, '');
  const platform = meta.platform.replace(/[^a-zA-Z0-9.-]/g, '_') || 'meeting';
  return `openmeetrec_${platform}_${stamp}.${extension}`;
}
