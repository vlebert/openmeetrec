import { describe, expect, it } from 'vitest';

import { micDisplayName, micOptions, resolveMicChoice, type DeviceLike } from '@/audio/micDevices';

const mic = (deviceId: string, groupId: string, label: string): DeviceLike => ({
  deviceId,
  groupId,
  kind: 'audioinput',
  label,
});

// Ce que Chromium renvoie sur un Mac avec un casque branché, défaut = micro interne.
const DEVICES: DeviceLike[] = [
  mic('default', 'g-builtin', 'Default - MacBook Pro Microphone (Built-in)'),
  mic('builtin', 'g-builtin', 'MacBook Pro Microphone (Built-in)'),
  mic('headset', 'g-headset', 'Jabra Evolve2 65'),
  { deviceId: 'speakers', groupId: 'g-builtin', kind: 'audiooutput', label: 'MacBook Pro Speakers' },
];

describe('micOptions', () => {
  it('présente le défaut système avec le nom du micro qu’il désigne, puis les vrais micros', () => {
    expect(micOptions(DEVICES)).toEqual([
      { value: '', label: 'System default (MacBook Pro Microphone (Built-in))' },
      { value: 'builtin', label: 'MacBook Pro Microphone (Built-in)' },
      { value: 'headset', label: 'Jabra Evolve2 65' },
    ]);
  });

  it('écarte le pseudo-périphérique « communications » de Windows', () => {
    const devices = [...DEVICES, mic('communications', 'g-headset', 'Communications - Jabra Evolve2 65')];
    expect(micOptions(devices).map((option) => option.value)).toEqual(['', 'builtin', 'headset']);
  });

  it('numérote les micros quand l’autorisation n’est pas accordée (libellés vides)', () => {
    const devices = [mic('default', 'g1', ''), mic('a', 'g1', ''), mic('b', 'g2', '')];
    expect(micOptions(devices)).toEqual([
      { value: '', label: 'System default' },
      { value: 'a', label: 'Microphone 1' },
      { value: 'b', label: 'Microphone 2' },
    ]);
  });

  it('garde au moins le défaut système sans aucun périphérique', () => {
    expect(micOptions([])).toEqual([{ value: '', label: 'System default' }]);
  });
});

describe('resolveMicChoice', () => {
  it('garde le défaut système', () => {
    expect(resolveMicChoice(null, DEVICES)).toEqual({ choice: null, missing: false });
  });

  it('garde un micro mémorisé encore branché', () => {
    expect(resolveMicChoice('headset', DEVICES)).toEqual({ choice: 'headset', missing: false });
  });

  it('se replie sur le défaut quand le micro mémorisé a disparu', () => {
    expect(resolveMicChoice('unplugged', DEVICES)).toEqual({ choice: null, missing: true });
  });

  it('ne confond pas un micro avec une sortie audio de même identifiant', () => {
    expect(resolveMicChoice('speakers', DEVICES)).toEqual({ choice: null, missing: true });
  });
});

describe('micDisplayName', () => {
  it('nomme un micro choisi explicitement', () => {
    expect(micDisplayName({ deviceId: 'headset', groupId: 'g-headset', label: 'Jabra Evolve2 65' }, DEVICES)).toBe(
      'Jabra Evolve2 65',
    );
  });

  it('retrouve le vrai micro derrière le défaut système', () => {
    const track = { deviceId: 'default', groupId: 'g-builtin', label: 'Default - MacBook Pro Microphone (Built-in)' };
    expect(micDisplayName(track, DEVICES)).toBe('MacBook Pro Microphone (Built-in)');
  });

  it('retombe sur le libellé de la piste sans liste de périphériques', () => {
    expect(micDisplayName({ deviceId: 'x', label: 'Some mic' }, [])).toBe('Some mic');
    expect(micDisplayName({ label: '' }, [])).toBe('Unknown microphone');
  });
});
