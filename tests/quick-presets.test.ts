import { describe, expect, it } from 'vitest';
import { QUICK_PRESETS, settingsForEffect, settingsForQuickPreset } from '../src/audio/presets';

describe('one-tap preset definitions', () => {
  it('offers only the documented slowed and sped choices', () => {
    expect(QUICK_PRESETS).toEqual([
      { effect: 'slowed', label: 'Slowed + reverb' },
      { effect: 'sped', label: 'Sped up' },
    ]);
  });

  it('reuses the exact complete settings that editor effect cards use', () => {
    expect(settingsForQuickPreset('slowed')).toEqual(settingsForEffect('slowed'));
    expect(settingsForQuickPreset('sped')).toEqual(settingsForEffect('sped'));
  });
});
