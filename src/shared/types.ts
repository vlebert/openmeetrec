/**
 * Types partagés. Ce module est PUR : aucune dépendance à `chrome` ni au DOM.
 */

export type ProviderId = 'mistral' | 'openai' | 'custom' | 'mock';

/** Un segment de transcription, timestamps en secondes absolues après merge. */
export interface Segment {
  text: string;
  start: number;
  end: number;
  /** Présent seulement si le provider fait de la diarization. */
  speakerId?: string;
}

/** Bornes temporelles d'un chunk, en secondes depuis le début de l'enregistrement. */
export interface ChunkInfo {
  index: number;
  start: number;
  end: number;
}

export interface ChunkOptions {
  /** Durée d'un chunk en secondes. */
  chunkDuration: number;
  /** Recouvrement entre deux chunks consécutifs, en secondes. */
  overlap: number;
}

export interface TranscribeOpts {
  model: string;
  language?: string | null;
  /** Ignoré si le provider ne supporte pas la diarization. */
  diarize: boolean;
}

export interface TranscriptionResult {
  text: string;
  /** Présents dès que le provider expose `supportsSegments`. */
  segments?: Segment[];
}

/** Résultat de transcription d'un chunk, succès ou échec. */
export type ChunkResult =
  | { status: 'ok'; chunk: ChunkInfo; result: TranscriptionResult }
  | { status: 'failed'; chunk: ChunkInfo; error: string };

export interface Config {
  provider: Exclude<ProviderId, 'mock'>;
  model: string;
  customEndpoint?: string;
  customSupportsSegments?: boolean;
  customSupportsDiarization?: boolean;
  apiKeys: Partial<Record<Exclude<ProviderId, 'mock'>, string>>;
  diarize: boolean;
  downloadAudio: boolean;
  /** `null` = détection automatique de la langue. */
  language: string | null;
}

/** Métadonnées d'une session, pour le frontmatter de l'export. */
export interface SessionMeta {
  provider: ProviderId;
  model: string;
  /** ISO 8601. */
  date: string;
  /** Durée de l'enregistrement en secondes. */
  duration: number;
  /** Hôte de l'onglet capturé, ex. `meet.google.com`. */
  platform: string;
  extensionVersion: string;
}
