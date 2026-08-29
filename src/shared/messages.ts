/**
 * Protocole de messages entre popup, service worker et offscreen document.
 * Ce module est PUR : aucune dépendance à `chrome` ni au DOM.
 *
 * Le champ `target` n'est pas décoratif : `chrome.runtime.sendMessage` diffuse à
 * *tous* les contextes de l'extension. Sans lui, l'offscreen document reçoit
 * aussi les messages destinés au service worker (et inversement), et les deux
 * répondent au même appel.
 */

import type { CaptureGrant } from '@/capture/strategy';
import type { SessionMeta } from '@/shared/types';

export type SessionStatus = 'idle' | 'recording' | 'processing' | 'done' | 'error';

export type SessionErrorCode =
  | 'mic-permission'
  | 'capture-failed'
  | 'unsupported'
  | 'already-recording'
  | 'internal';

export interface SessionError {
  code: SessionErrorCode;
  message: string;
}

export interface SessionState {
  status: SessionStatus;
  sessionId: string | null;
  tabId: number | null;
  /** Hôte de l'onglet capturé, ex. `meet.google.com`. */
  platform: string;
  /** Epoch ms, `null` hors enregistrement. */
  startedAt: number | null;
  /** Secondes, figée une fois l'enregistrement terminé. */
  duration: number;
  chunkCount: number;
  micEnabled: boolean;
  /** Avancement de la transcription pendant `processing`. */
  progress: { done: number; total: number } | null;
  /** Chemins des fichiers téléchargés en fin de session. */
  downloads: string[];
  error: SessionError | null;
}

export const IDLE_STATE: SessionState = {
  status: 'idle',
  sessionId: null,
  tabId: null,
  platform: '',
  startedAt: null,
  duration: 0,
  chunkCount: 0,
  micEnabled: true,
  progress: null,
  downloads: [],
  error: null,
};

export interface AudioLevels {
  /** RMS normalisé 0..1. */
  tab: number;
  mic: number;
}

/** Messages traités par le service worker. */
export type ToWorkerMessage =
  | { target: 'sw'; type: 'START_RECORDING'; tabId: number; url: string; micEnabled: boolean }
  | { target: 'sw'; type: 'STOP_RECORDING' }
  | { target: 'sw'; type: 'GET_STATE' }
  | { target: 'sw'; type: 'RESET' }
  | { target: 'sw'; type: 'CHUNK_READY'; index: number; start: number; end: number }
  | { target: 'sw'; type: 'RECORDING_STOPPED'; duration: number; chunkCount: number }
  | { target: 'sw'; type: 'PIPELINE_PROGRESS'; done: number; total: number }
  | { target: 'sw'; type: 'CAPTURE_ERROR'; error: SessionError };

/** Messages traités par l'offscreen document. */
export type ToOffscreenMessage =
  | {
      target: 'offscreen';
      type: 'START_CAPTURE';
      sessionId: string;
      grant: CaptureGrant;
      micEnabled: boolean;
      keepFullTrack: boolean;
    }
  | { target: 'offscreen'; type: 'STOP_CAPTURE' }
  | { target: 'offscreen'; type: 'RUN_PIPELINE'; sessionId: string; meta: SessionMeta }
  | { target: 'offscreen'; type: 'GET_LEVELS' };

export type ExtensionMessage = ToWorkerMessage | ToOffscreenMessage;

export interface Ack {
  ok: boolean;
  error?: SessionError;
}

/**
 * Fichier prêt à télécharger. L'URL est un blob créé dans l'offscreen document :
 * `URL.createObjectURL` n'existe pas dans un service worker, et un `data:` URL
 * ne passe pas à l'échelle d'une piste audio d'une heure. Le service worker,
 * lui, est le seul à pouvoir appeler `chrome.downloads`.
 */
export interface DownloadRequest {
  url: string;
  filename: string;
}

export interface PipelineReport {
  ok: boolean;
  error?: SessionError;
  downloads: DownloadRequest[];
  failedChunks: number[];
  transcribedCount: number;
  hadSegments: boolean;
}

export function isForWorker(message: unknown): message is ToWorkerMessage {
  return isMessage(message) && message.target === 'sw';
}

export function isForOffscreen(message: unknown): message is ToOffscreenMessage {
  return isMessage(message) && message.target === 'offscreen';
}

function isMessage(value: unknown): value is { target: string; type: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { target?: unknown }).target === 'string' &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

/** Hôte de l'onglet, pour les métadonnées de session. Jamais l'URL complète. */
export function platformFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
