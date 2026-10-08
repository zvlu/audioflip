import type { EffectId, EffectSettings } from './types';

export const NEUTRAL_SETTINGS: EffectSettings = {
  effect: 'original',
  rate: 1,
  reverbMix: 0.2,
  bassGain: 6,
  brightness: true,
};

/** Returns a complete preset so reselecting an effect restores its documented defaults. */
export function settingsForEffect(effect: EffectId): EffectSettings {
  if (effect === 'slowed') {
    return { ...NEUTRAL_SETTINGS, effect, rate: 0.8, reverbMix: 0.2 };
  }
  if (effect === 'sped') {
    return { ...NEUTRAL_SETTINGS, effect, rate: 1.25 };
  }
  if (effect === 'nightcore') {
    return { ...NEUTRAL_SETTINGS, effect, rate: 1.35, brightness: true };
  }
  if (effect === 'bass') {
    return { ...NEUTRAL_SETTINGS, effect, bassGain: 6 };
  }
  return { ...NEUTRAL_SETTINGS };
}
