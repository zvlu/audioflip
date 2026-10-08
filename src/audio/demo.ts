/** Creates an original, local tone-and-percussion demo without fetching any media. */
export function createDemoBuffer(context: BaseAudioContext): AudioBuffer {
  const sampleRate = context.sampleRate || 44_100;
  const duration = 10;
  const length = Math.floor(sampleRate * duration);
  const buffer = context.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  let seed = 47;

  const noise = (): number => {
    seed = (seed * 16_807) % 2_147_483_647;
    return seed / 1_073_741_823.5 - 1;
  };

  for (let frame = 0; frame < length; frame += 1) {
    const time = frame / sampleRate;
    const beat = time % 0.5;
    const kick = beat < 0.18 ? Math.sin(2 * Math.PI * (105 - beat * 340) * beat) * Math.exp(-beat * 21) : 0;
    const hatPhase = time % 0.25;
    const hat = hatPhase < 0.055 ? noise() * Math.exp(-hatPhase * 58) * 0.16 : 0;
    const bassFrequency = [98, 98, 123.47, 82.41][Math.floor(time / 2) % 4];
    const bass = Math.sin(2 * Math.PI * bassFrequency * time) * 0.18;
    const noteIndex = Math.floor(time / 0.5) % 8;
    const note = [392, 493.88, 587.33, 493.88, 440, 523.25, 659.25, 523.25][noteIndex];
    const notePhase = time % 0.5;
    const pluck = notePhase < 0.39 ? Math.sin(2 * Math.PI * note * time) * Math.exp(-notePhase * 4.7) * 0.19 : 0;
    const swell = Math.sin(2 * Math.PI * 0.1 * time) * 0.015;
    left[frame] = kick + hat + bass + pluck + swell;
    right[frame] = kick * 0.92 + hat * 0.75 + bass + pluck * 0.84 - swell;
  }

  return buffer;
}
