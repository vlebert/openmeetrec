import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEETING_PATTERNS,
  matchMeetingUrl,
  normalizeMeetingPattern,
  normalizeMeetingPatterns,
} from '@/meetings/patterns';

describe('normalizeMeetingPattern', () => {
  it('complète un motif sans chemin', () => {
    expect(normalizeMeetingPattern('meet.google.com')).toBe('meet.google.com/*');
    expect(normalizeMeetingPattern('meet.google.com/')).toBe('meet.google.com/*');
  });

  it('accepte une URL collée depuis la barre d adresse', () => {
    expect(normalizeMeetingPattern('  HTTPS://Meet.Google.com/abc  ')).toBe('meet.google.com/abc');
  });

  it('rejette ce qui est inexploitable', () => {
    for (const input of ['', '   ', 'a b', '/chemin/seul', '*/*', 42, null, undefined]) {
      expect(normalizeMeetingPattern(input)).toBeNull();
    }
  });

  it('dédoublonne une liste après normalisation', () => {
    expect(normalizeMeetingPatterns(['meet.google.com', 'https://meet.google.com/', 'x'])).toEqual([
      'meet.google.com/*',
      'x/*',
    ]);
    expect(normalizeMeetingPatterns('pas un tableau')).toEqual([]);
  });
});

describe('matchMeetingUrl', () => {
  const patterns = ['meet.google.com/*', '*.zoom.us/j/*', 'teams.live.com/meet/*'];

  it('reconnaît une page de visio et renvoie le motif', () => {
    expect(matchMeetingUrl('https://meet.google.com/abc-defg-hij', patterns)).toBe(
      'meet.google.com/*',
    );
    expect(matchMeetingUrl('https://teams.live.com/meet/93123?p=x', patterns)).toBe(
      'teams.live.com/meet/*',
    );
  });

  it('fait correspondre l hôte et ses sous-domaines avec `*.`', () => {
    expect(matchMeetingUrl('https://us02web.zoom.us/j/123', patterns)).toBe('*.zoom.us/j/*');
    expect(matchMeetingUrl('https://zoom.us/j/123', patterns)).toBe('*.zoom.us/j/*');
  });

  it('ne reconnaît pas un hôte voisin ni un autre chemin', () => {
    expect(matchMeetingUrl('https://notzoom.us/j/123', patterns)).toBeNull();
    expect(matchMeetingUrl('https://zoom.us/pricing', patterns)).toBeNull();
    expect(matchMeetingUrl('https://meet.google.com.evil.test/abc', patterns)).toBeNull();
  });

  /** Le joker de l'hôte ne doit pas traverser le `/` et avaler un chemin. */
  it('ne laisse pas le joker d hôte déborder sur le chemin', () => {
    expect(matchMeetingUrl('https://evil.test/meet.google.com/abc', ['meet*/*'])).toBeNull();
  });

  it('ignore ce qui n est pas une page web', () => {
    expect(matchMeetingUrl('chrome://extensions', ['*/*'])).toBeNull();
    expect(matchMeetingUrl('pas une url', patterns)).toBeNull();
    expect(matchMeetingUrl('https://meet.google.com/abc', [])).toBeNull();
  });

  it('tolère les motifs bruts de la config sans normalisation préalable', () => {
    expect(matchMeetingUrl('https://meet.google.com/abc', [' MEET.GOOGLE.COM '])).toBe(
      'meet.google.com/*',
    );
  });

  it('reconnaît les plateformes de la liste par défaut', () => {
    const urls = [
      'https://meet.google.com/abc-defg-hij',
      'https://teams.microsoft.com/v2/?meetingjoin=true',
      'https://us02web.zoom.us/wc/join/123',
      'https://meet.jit.si/OpenMeetRecTest',
      'https://subdomain.whereby.com/room',
    ];
    for (const url of urls) {
      expect(matchMeetingUrl(url, DEFAULT_MEETING_PATTERNS), url).not.toBeNull();
    }
    expect(matchMeetingUrl('https://www.google.com/search?q=meet', DEFAULT_MEETING_PATTERNS)).toBeNull();
  });

  it('livre une liste par défaut déjà canonique', () => {
    expect(normalizeMeetingPatterns([...DEFAULT_MEETING_PATTERNS])).toEqual([
      ...DEFAULT_MEETING_PATTERNS,
    ]);
  });
});
