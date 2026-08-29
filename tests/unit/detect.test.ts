import { describe, expect, it } from 'vitest';
import { detectStrategyId, isCaptureSupported } from '@/capture/detect';

describe('detectStrategyId', () => {
  it('choisit tabCapture quand l API est présente', () => {
    expect(detectStrategyId({ chrome: { tabCapture: {} } })).toBe('tabcapture');
  });

  it('ne choisit rien sans API de capture', () => {
    expect(detectStrategyId({})).toBeNull();
    expect(detectStrategyId({ chrome: {} })).toBeNull();
  });

  it('résume la disponibilité', () => {
    expect(isCaptureSupported({ chrome: { tabCapture: {} } })).toBe(true);
    expect(isCaptureSupported({})).toBe(false);
  });
});
