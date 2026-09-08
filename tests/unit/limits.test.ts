import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, fitsInOneRequest, getLimits } from '@/providers/limits';

describe('getLimits', () => {
  it('donne les limites du provider pour un de ses modèles', () => {
    const limits = getLimits('mistral', 'voxtral-mini-latest');
    expect(limits.maxSingleRequestSeconds).toBe(90 * 60);
    expect(limits.maxSingleRequestBytes).toBeGreaterThan(0);
  });

  it('retombe sur le défaut du provider pour un modèle inconnu', () => {
    expect(getLimits('mistral', 'un-modele-jamais-vu')).toEqual(getLimits('mistral', 'voxtral-mini-latest'));
  });

  it('interdit la requête unique sur un endpoint custom, dont on ignore les limites', () => {
    expect(getLimits('custom', 'local')).toEqual(DEFAULT_LIMITS);
  });
});

describe('fitsInOneRequest', () => {
  const mistral = getLimits('mistral', 'voxtral-mini-latest');
  const openai = getLimits('openai', 'whisper-1');

  // Les cas ci-dessous sont les mesures réelles du 2026-09-08 (cf. limits.ts).
  it('accepte chez Mistral un enregistrement de 1 h 29 mesuré comme passant', () => {
    expect(fitsInOneRequest(mistral, 5350, 87_450_802)).toBe(true);
  });

  it('refuse chez Mistral au-delà du plafond de durée', () => {
    expect(fitsInOneRequest(mistral, 91 * 60, 10_000_000)).toBe(false);
  });

  it('accepte chez OpenAI un court extrait', () => {
    expect(fitsInOneRequest(openai, 17.4, 280_003)).toBe(true);
  });

  it('refuse chez OpenAI les 37 MiB refusés en HTTP 413', () => {
    expect(fitsInOneRequest(openai, 2395, 39_260_983)).toBe(false);
  });

  it('refuse sur un endpoint dont on ne connaît pas les limites', () => {
    expect(fitsInOneRequest(DEFAULT_LIMITS, 10, 1000)).toBe(false);
  });

  it('refuse sans mesure fiable de durée ou de taille', () => {
    expect(fitsInOneRequest(mistral, 0, 1000)).toBe(false);
    expect(fitsInOneRequest(mistral, 60, 0)).toBe(false);
  });
});
