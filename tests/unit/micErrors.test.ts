import { describe, expect, it } from 'vitest';

import { classifyMicError } from '@/audio/micErrors';

const domError = (name: string, message: string) => Object.assign(new Error(message), { name });

describe('classifyMicError', () => {
  it('autorisation refusée ou demande fermée : à régler côté extension', () => {
    expect(classifyMicError(domError('NotAllowedError', 'Permission dismissed')).kind).toBe('permission');
    expect(classifyMicError(domError('NotAllowedError', 'Permission denied')).kind).toBe('permission');
    expect(classifyMicError(domError('SecurityError', '')).kind).toBe('permission');
  });

  it('blocage par le système : l’autorisation de l’extension n’y peut rien', () => {
    const failure = classifyMicError(domError('NotAllowedError', 'Permission denied by system'));
    expect(failure.kind).toBe('system');
    expect(failure.message).toContain('System Settings');
  });

  it('aucun micro, ou micro choisi introuvable', () => {
    expect(classifyMicError(domError('NotFoundError', 'Requested device not found')).kind).toBe('not-found');
    expect(classifyMicError(domError('OverconstrainedError', '')).kind).toBe('not-found');
  });

  it('micro occupé ou illisible', () => {
    expect(classifyMicError(domError('NotReadableError', 'Could not start audio source')).kind).toBe('busy');
  });

  it('propose toujours d’enregistrer sans micro quand le micro est en cause', () => {
    for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError']) {
      expect(classifyMicError(domError(name, '')).message).toContain('Also record my microphone');
    }
  });

  it('erreur inconnue : garde le message d’origine', () => {
    expect(classifyMicError(domError('TypeError', 'boom'))).toEqual({ kind: 'other', message: 'Microphone error: boom' });
    expect(classifyMicError('raw')).toEqual({ kind: 'other', message: 'Microphone error: raw' });
  });
});
