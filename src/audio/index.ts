import type { Audio } from '../types.ts';
import { createSfx } from './sfx.ts';
import { createVoice } from './voice.ts';

/** The audio graph on one context: the public `Audio` and the limiter node every sound ends in. */
export interface AudioGraph {
  readonly audio: Audio;
  readonly output: DynamicsCompressorNode;
}

/** Builds the master bus (limiter into the destination), the voice bus and the ducked effects bus on `ctx`. */
export function createAudioGraph(ctx: AudioContext | OfflineAudioContext): AudioGraph {
  const output = ctx.createDynamicsCompressor();
  output.threshold.value = -8;
  output.knee.value = 3;
  output.ratio.value = 20;
  output.attack.value = 0.003;
  output.release.value = 0.15;
  output.connect(ctx.destination);

  const master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(output);

  const voiceBus = ctx.createGain();
  voiceBus.gain.value = 2.5;
  voiceBus.connect(master);
  const effectsBus = ctx.createGain();
  effectsBus.connect(master);

  return {
    output,
    audio: {
      unlock: () => ctx.resume(),
      voice: createVoice(ctx, voiceBus, effectsBus.gain),
      sfx: createSfx(ctx, effectsBus),
    },
  };
}

/** Creates the game's one AudioContext with its voice and effects. */
export function createAudio(): Audio {
  return createAudioGraph(new AudioContext()).audio;
}
