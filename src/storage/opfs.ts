/**
 * Persistance des chunks audio en OPFS (F-AUD-04).
 *
 * L'OPFS est le seul stockage qui accepte des dizaines de mégaoctets sans quota
 * de `chrome.storage` ni rétention en mémoire : les chunks y sont écrits au fil
 * de l'eau, relus un par un par le pipeline, puis effacés. Tout reste local.
 */

const SESSIONS_DIR = 'sessions';
const CHUNK_PREFIX = 'chunk-';
const CHUNK_SUFFIX = '.webm';
const TRACK_NAME = 'track.webm';

export interface TrackWriter {
  write(blob: Blob): Promise<void>;
  close(): Promise<void>;
}

export function chunkFileName(index: number): string {
  return `${CHUNK_PREFIX}${String(index).padStart(4, '0')}${CHUNK_SUFFIX}`;
}

async function sessionDir(sessionId: string, create = false): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const sessions = await root.getDirectoryHandle(SESSIONS_DIR, { create });
  return sessions.getDirectoryHandle(sessionId, { create });
}

export async function writeChunk(sessionId: string, index: number, blob: Blob): Promise<void> {
  const dir = await sessionDir(sessionId, true);
  const file = await dir.getFileHandle(chunkFileName(index), { create: true });
  const writable = await file.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function readChunk(sessionId: string, index: number): Promise<File> {
  const dir = await sessionDir(sessionId);
  const file = await dir.getFileHandle(chunkFileName(index));
  return file.getFile();
}

/** Indices des chunks présents, triés. */
export async function listChunks(sessionId: string): Promise<number[]> {
  const dir = await sessionDir(sessionId);
  const indices: number[] = [];
  for await (const name of dir.keys()) {
    if (!name.startsWith(CHUNK_PREFIX) || !name.endsWith(CHUNK_SUFFIX)) continue;
    const index = Number.parseInt(name.slice(CHUNK_PREFIX.length, -CHUNK_SUFFIX.length), 10);
    if (Number.isInteger(index)) indices.push(index);
  }
  return indices.sort((a, b) => a - b);
}

/**
 * Piste continue pour l'export audio optionnel (F-AUD-08). Le writable reste
 * ouvert toute la session : rouvrir le fichier à chaque timeslice obligerait à
 * relire ce qui est déjà écrit.
 */
export async function openTrackWriter(sessionId: string): Promise<TrackWriter> {
  const dir = await sessionDir(sessionId, true);
  const file = await dir.getFileHandle(TRACK_NAME, { create: true });
  const writable = await file.createWritable();
  let offset = 0;
  return {
    async write(blob) {
      await writable.write({ type: 'write', position: offset, data: blob });
      offset += blob.size;
    },
    async close() {
      await writable.close();
    },
  };
}

export async function readTrack(sessionId: string): Promise<File | null> {
  try {
    const dir = await sessionDir(sessionId);
    const file = await dir.getFileHandle(TRACK_NAME);
    return await file.getFile();
  } catch {
    return null;
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const sessions = await root.getDirectoryHandle(SESSIONS_DIR);
    await sessions.removeEntry(sessionId, { recursive: true });
  } catch {
    // Session déjà absente : rien à faire.
  }
}

/** Efface toutes les sessions sauf celle indiquée. Appelé au démarrage d'une session. */
export async function pruneSessions(keepSessionId: string | null): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const sessions = await root.getDirectoryHandle(SESSIONS_DIR);
    const names: string[] = [];
    for await (const name of sessions.keys()) {
      if (name !== keepSessionId) names.push(name);
    }
    for (const name of names) {
      await sessions.removeEntry(name, { recursive: true });
    }
  } catch {
    // Pas encore de répertoire de sessions.
  }
}
