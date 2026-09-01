/**
 * Reconnaissance des pages de visioconférence par motif d'URL. Module PUR :
 * aucune dépendance à `chrome` ni au DOM (règle projet), pour que la liste de
 * motifs et le matching soient testables sans navigateur.
 *
 * Un motif s'écrit `hôte/chemin`, avec `*` comme joker :
 *
 * - `meet.google.com/*`   → n'importe quelle page de cet hôte
 * - `*.zoom.us/j/*`       → l'hôte et ses sous-domaines (`zoom.us`, `us02web.zoom.us`)
 * - `teams.live.com/meet/*`
 *
 * Le format est volontairement plus simple que les match patterns Chrome : la
 * liste est éditable par l'utilisateur dans les réglages, elle doit rester
 * lisible et pardonner les approximations (schéma oublié, chemin absent).
 */

/**
 * Liste livrée par défaut. Elle n'est qu'une valeur initiale : la config stocke
 * la liste effective, que l'utilisateur peut compléter ou vider.
 */
export const DEFAULT_MEETING_PATTERNS: readonly string[] = [
  'meet.google.com/*',
  'teams.microsoft.com/*',
  'teams.live.com/*',
  '*.zoom.us/j/*',
  '*.zoom.us/wc/*',
  'meet.jit.si/*',
  '8x8.vc/*',
  '*.whereby.com/*',
  '*.webex.com/*',
  'app.livestorm.co/*',
  '*.gotomeeting.com/*',
  'app.slack.com/huddle/*',
];

/**
 * Met un motif saisi à la main sous forme canonique, ou renvoie `null` s'il est
 * inexploitable. Tolère ce qu'on colle depuis la barre d'adresse : schéma,
 * espaces, casse, chemin absent.
 */
export function normalizeMeetingPattern(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let pattern = input.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  if (pattern === '' || /\s/.test(pattern)) return null;
  // Un motif sans chemin vaut pour tout le site, et un chemin nu vaut « et la suite ».
  const slash = pattern.indexOf('/');
  if (slash === -1) pattern += '/*';
  else if (pattern.endsWith('/')) pattern += '*';
  // `*` seul comme hôte ferait un rappel sur toute page visitée : jamais implicite.
  if (pattern.startsWith('*/') || pattern.startsWith('/')) return null;
  return pattern;
}

/** Normalise une liste, jette les motifs invalides et les doublons. */
export function normalizeMeetingPatterns(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const raw of input) {
    const pattern = normalizeMeetingPattern(raw);
    if (pattern !== null) seen.add(pattern);
  }
  return [...seen];
}

/**
 * Renvoie le motif qui reconnaît l'URL, ou `null`. Renvoyer le motif et pas un
 * booléen sert au service worker : tant que l'onglet reste sur le *même* motif,
 * il ne renotifie pas (une SPA comme Teams change d'URL en permanence).
 */
export function matchMeetingUrl(url: string, patterns: readonly string[]): string | null {
  let target: string;
  try {
    const parsed = new URL(url);
    // Les pages internes du navigateur et les URLs d'extension ne sont pas des visios.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    target = `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
  } catch {
    return null;
  }
  for (const raw of patterns) {
    const pattern = normalizeMeetingPattern(raw);
    if (pattern !== null && toRegExp(pattern).test(target)) return pattern;
  }
  return null;
}

/**
 * Traduit un motif canonique en expression régulière ancrée. Dans l'hôte, `*`
 * ne traverse pas le `/` — sans quoi `meet.google.com*` reconnaîtrait n'importe
 * quel chemin d'un autre site.
 */
function toRegExp(pattern: string): RegExp {
  const slash = pattern.indexOf('/');
  const host = pattern.slice(0, slash);
  const path = pattern.slice(slash);
  const hostSource = host.startsWith('*.')
    ? `(?:[^/]+\\.)?${glob(host.slice(2), '[^/]*')}`
    : glob(host, '[^/]*');
  return new RegExp(`^${hostSource}${glob(path, '.*')}$`);
}

function glob(part: string, wildcard: string): string {
  return part
    .split('*')
    .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join(wildcard);
}
