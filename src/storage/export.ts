/**
 * Fabrication des fichiers exportés (F-EX-01/02).
 *
 * Les blobs sont créés ici, dans l'offscreen document : seul un contexte avec
 * DOM dispose de `URL.createObjectURL`. Le service worker reçoit des URLs et
 * déclenche les téléchargements.
 */

import { buildFilename, buildMarkdown, type TranscriptDocument } from '@/shared/format';
import type { DownloadRequest } from '@/shared/messages';
import type { SessionMeta } from '@/shared/types';

export function markdownDownload(doc: TranscriptDocument): DownloadRequest {
  const blob = new Blob([buildMarkdown(doc)], { type: 'text/markdown;charset=utf-8' });
  return { url: URL.createObjectURL(blob), filename: buildFilename(doc.meta, 'md') };
}

export function audioDownload(meta: SessionMeta, audio: Blob): DownloadRequest {
  return { url: URL.createObjectURL(audio), filename: buildFilename(meta, 'webm') };
}

export function revokeDownloads(downloads: readonly DownloadRequest[]): void {
  for (const download of downloads) URL.revokeObjectURL(download.url);
}
