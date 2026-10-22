/**
 * Limites d'envoi par provider et par modèle. Module PUR.
 *
 * C'est ce qui décide, **avant tout appel réseau**, si un enregistrement part en
 * une seule requête ou découpé en chunks. L'enjeu n'est pas la performance mais
 * la diarization : en une seule requête les identités de speakers valent pour
 * toute la réunion, alors qu'en chunks elles sont réattribuées à chaque
 * frontière et deviennent inaffichables (cf. `shared/format.ts`,
 * `hasGlobalSpeakers`).
 *
 * La décision est déterministe — durée et taille sont connues avant l'appel —
 * pour qu'un dépassement de limite ne coûte jamais une requête ratée. Le repli
 * à l'exécution ne sert donc plus qu'aux échecs imprévus (5xx, timeout).
 *
 * Chaque entrée dit si sa valeur est **mesurée** ou **documentée** : la doc des
 * providers se contredit (Mistral annonce 60 min sur sa page « known
 * limitations » et 3 h sur celle de Transcribe 2), donc une valeur mesurée prime
 * toujours sur une valeur annoncée.
 */

import type { ProviderId } from '@/shared/types';

export interface TranscriptionLimits {
  /** Durée maximale acceptée en une seule requête, en secondes. */
  maxSingleRequestSeconds: number;
  /** Taille maximale du fichier envoyé en une seule requête, en octets. */
  maxSingleRequestBytes: number;
  /**
   * Fenêtre de contexte du modèle, en tokens, quand la **sortie** y est comptée
   * avec l'audio. Une réponse qui la remplit est tronquée sans erreur : le
   * provider s'en sert pour la rejeter (cf. `providers/mistral.ts`).
   */
  contextTokens?: number;
}

const MB = 1024 * 1024;

/**
 * Voxtral 3 (Mini et Small Transcribe 3). MESURÉ (2026-10-22) :
 *
 * - fenêtre de 65 536 tokens **sortie comprise** : 12,5 tokens par seconde
 *   d'audio + ~5 tokens par seconde de texte transcrit (diarization incluse) ;
 * - 1 h 29 refusé d'emblée (`Prompt 67130 > 65536 maximum context length`,
 *   HTTP 400 → repli en chunks) ;
 * - 1 h 25 **accepté mais tronqué en silence** : la transcription s'arrête à
 *   5 min 18, `total_tokens` vaut 65 536 pile, `finish_reason` vaut `null`
 *   comme sur une réponse complète ;
 * - 45 min couverts à 100 % sur les deux modèles, 47,5k tokens consommés.
 *
 * Le plafond réel dépend donc du débit de parole (~62 min sur l'enregistrement
 * mesuré). 45 min laissent ~×2 de marge sur la sortie, pour une réunion plus
 * dense que celle mesurée. Au-delà, chunks : on y perd la cohérence des
 * speakers sur toute la réunion, pas du texte.
 */
const VOXTRAL_3: TranscriptionLimits = {
  maxSingleRequestSeconds: 45 * 60,
  maxSingleRequestBytes: 500 * MB,
  contextTokens: 65_536,
};

/**
 * Défaut volontairement nul : un endpoint dont on ne connaît pas les limites
 * part en chunks. Se tromper par excès de prudence coûte des identités de
 * speakers ; se tromper dans l'autre sens coûte une réunion entière refusée
 * après plusieurs minutes d'upload.
 */
export const DEFAULT_LIMITS: TranscriptionLimits = {
  maxSingleRequestSeconds: 0,
  maxSingleRequestBytes: 0,
};

interface ProviderLimits {
  /** S'applique à tout modèle du provider sans surcharge propre. */
  default: TranscriptionLimits;
  byModel?: Record<string, TranscriptionLimits>;
}

const PROVIDER_LIMITS: Partial<Record<Exclude<ProviderId, 'mock'>, ProviderLimits>> = {
  mistral: {
    default: {
      // MESURÉ (2026-09-08, `voxtral-mini-2602` alias `voxtral-mini-latest`) :
      // un webm MediaRecorder de 1 h 29 min passe en une requête, transcrit à
      // 99,9 % de sa durée, sans troncature silencieuse. La doc Transcribe 2
      // annonce 3 h, jamais vérifié au-delà de 1 h 29 — d'où ce plafond à 1 h 30
      // plutôt que les 10800 s annoncées.
      maxSingleRequestSeconds: 90 * 60,
      // DOCUMENTÉ : 500 MB (« known limitations »), 1 GB annoncé pour
      // Transcribe 2. On garde la valeur basse : à ~131 kbps elle représente
      // déjà plus de 8 h d'audio, donc c'est la durée qui contraint, jamais elle.
      maxSingleRequestBytes: 500 * MB,
    },
    byModel: {
      'voxtral-mini-transcribe-3': VOXTRAL_3,
      'voxtral-mini-transcribe-3-0': VOXTRAL_3,
      'voxtral-small-transcribe-3': VOXTRAL_3,
      'voxtral-small-transcribe-3-0': VOXTRAL_3,
    },
  },
  openai: {
    default: {
      // DOCUMENTÉ : pas de plafond de durée annoncé sur `whisper-1`, la seule
      // limite est la taille du fichier.
      maxSingleRequestSeconds: Number.POSITIVE_INFINITY,
      // MESURÉ (2026-09-08) : un envoi de 37 MiB est refusé en HTTP 413 avec
      // « Maximum content size limit (26214400) exceeded », soit 25 MiB pile.
      // Le serveur compte le corps multipart entier, pas le seul fichier, d'où
      // la marge : elle couvre les en-têtes de parties et les autres champs.
      // ~25 min d'audio à notre débit d'encodage (~131 kbps).
      maxSingleRequestBytes: 25 * MB - 64 * 1024,
    },
  },
  // `custom` : endpoint inconnu, donc `DEFAULT_LIMITS` — toujours en chunks.
};

/** Limites applicables à un couple provider/modèle, défauts compris. */
export function getLimits(provider: Exclude<ProviderId, 'mock'>, model: string): TranscriptionLimits {
  const forProvider = PROVIDER_LIMITS[provider];
  if (!forProvider) return DEFAULT_LIMITS;
  return forProvider.byModel?.[model] ?? forProvider.default;
}

/**
 * L'enregistrement tient-il en une seule requête ?
 *
 * Une durée ou une taille nulle renvoie `false` : sans mesure fiable, on ne
 * parie pas sur un envoi qui peut échouer après plusieurs minutes d'upload.
 */
export function fitsInOneRequest(
  limits: TranscriptionLimits,
  durationSeconds: number,
  sizeBytes: number,
): boolean {
  if (!(durationSeconds > 0) || !(sizeBytes > 0)) return false;
  return durationSeconds <= limits.maxSingleRequestSeconds && sizeBytes <= limits.maxSingleRequestBytes;
}
