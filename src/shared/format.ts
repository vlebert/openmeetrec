/**
 * Génération du markdown exporté. Module PUR.
 *
 * Format : frontmatter YAML + transcription en markdown simple (PRD §7).
 */

import type { Segment, SessionMeta } from '@/shared/types';
import { countSpeakers, groupSegmentsBySpeaker, type SpeakerTurn } from '@/audio/merge';

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
  /** Bornes de chunk (`audio/merge#chunkBoundaries`) : coutures de l'export. Vide = une seule requête. */
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

/**
 * `0` → `Speaker 0` ; un identifiant déjà lisible est laissé tel quel.
 *
 * Les providers ne s'accordent pas sur la forme de l'identifiant : Voxtral
 * renvoie `speaker_1`, d'autres `SPEAKER_00` ou un entier nu. C'est la même
 * notion, donc le même rendu — sans quoi l'export sort un `**speaker_1**` en
 * minuscules au milieu de `Speaker ?`.
 */
export function formatSpeaker(speakerId: string | undefined): string {
  if (speakerId === undefined || speakerId === '') return 'Speaker ?';
  if (/^\d+$/.test(speakerId)) return `Speaker ${speakerId}`;
  // `Number` normalise au passage les zéros de tête (`SPEAKER_00` → `Speaker 0`).
  const numbered = /^speaker[ _-]?(\d+)$/i.exec(speakerId);
  return numbered ? `Speaker ${Number(numbered[1])}` : speakerId;
}

/**
 * Les identités de speakers valent-elles pour tout le document ?
 *
 * Vrai quand la transcription tient en une seule requête, donc sans aucune
 * couture : les identifiants viennent alors d'une unique passe de diarization.
 * Dès qu'il y a une frontière de chunk, « Speaker 0 » d'un côté n'est pas
 * « Speaker 0 » de l'autre — les libellés deviennent trompeurs et ne sont plus
 * affichés (cf. `buildBody`).
 */
export function hasGlobalSpeakers(doc: TranscriptDocument): boolean {
  return doc.diarized && (doc.chunkBoundaries ?? []).length === 0;
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
  // Compter les speakers n'a de sens que si leurs identités sont globales :
  // sinon on additionnerait des identifiants locaux à chaque chunk.
  if (hasGlobalSpeakers(doc) && doc.segments) {
    lines.push(`speakers: ${countSpeakers(doc.segments)}`);
  }
  lines.push(`extension_version: ${escapeYamlValue(meta.extensionVersion)}`);
  return `---\n${lines.join('\n')}\n---`;
}

/**
 * Avertissements portés par le document.
 *
 * Ils existent parce que trois limitations connues sont invisibles dans le texte
 * final : les doublons de la concaténation sans timestamps, l'absence de nom de
 * speaker en transcription par chunks, et les passages manquants.
 */
export function buildWarnings(doc: TranscriptDocument): string[] {
  const warnings: string[] = [];

  if (!doc.hadSegments && doc.chunkCount > 1) {
    warnings.push(
      'The model in use does not return timestamps: chunks were concatenated as-is, ' +
        'text in overlapping zones may appear duplicated.',
    );
  }
  if (doc.diarized && !hasGlobalSpeakers(doc)) {
    warnings.push(
      'Speakers are not named: this transcript was assembled from several chunks, ' +
        'and a speaker cannot be matched across a chunk boundary. Diarization is only ' +
        'used for layout — a blank line marks a change of speaker, `---` marks a boundary.',
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
    const turns = groupSegmentsBySpeaker(doc.segments, boundaries).filter((t) => t.text !== '');
    return hasGlobalSpeakers(doc) ? namedTurns(turns) : anonymousTurns(turns, boundaries);
  }

  const text =
    doc.text ??
    (doc.segments ?? [])
      .map((s) => s.text.trim())
      .filter(Boolean)
      .join(' ');

  return text.trim();
}

/** Un paragraphe par tour de parole, libellé du speaker en tête. */
function namedTurns(turns: readonly SpeakerTurn[]): string {
  return turns
    .map((turn) => `**${formatSpeaker(turn.speakerId)}** (${formatTimestamp(turn.start)}): ${turn.text}`)
    .join('\n\n');
}

/**
 * Même découpage en tours de parole, mais sans nommer personne : le changement
 * de speaker n'est plus qu'un saut de paragraphe, et chaque frontière de chunk
 * devient une règle horizontale. Le timestamp reste le seul repère pour
 * retrouver un passage dans l'audio.
 */
function anonymousTurns(turns: readonly SpeakerTurn[], boundaries: readonly number[]): string {
  const blocks: string[] = [];
  let crossed = 0;

  for (const turn of turns) {
    let seam = false;
    while (crossed < boundaries.length && turn.start >= boundaries[crossed]!) {
      crossed += 1;
      seam = true;
    }
    // Une seule règle même si un chunk entier n'a produit aucun tour, et jamais
    // de règle en tête de document.
    if (seam && blocks.length > 0) blocks.push('---');
    blocks.push(`(${formatTimestamp(turn.start)}) ${turn.text}`);
  }

  return blocks.join('\n\n');
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
