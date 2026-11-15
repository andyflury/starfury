import { createHash } from 'node:crypto';

/** Speech model, voice and request format of every clip. */
export const SPEECH = { model: 'gpt-4o-mini-tts', voice: 'onyx', responseFormat: 'pcm', sampleRate: 24000 } as const;

const OPENING = [
  'Role: The voice of a mission control flight controller on the launch loop, talking to the flight director during a rocket launch.',
  'Affect: A calm, experienced launch controller with radio discipline; low, steady and precise.',
  'Tone: Quietly confident and professional; never theatrical, no storytelling melody, no sing-song.',
  'Pacing: Measured and clipped, like call-outs during a countdown.',
  'Pronunciation: Clear, natural Standard German, with no dialect. These proper names are English and are pronounced in English: StarFury ("Star Fury"), Starship, SpaceX, Super Heavy, Raptor, Starbase, Mechazilla, Chopsticks.',
];

const CLOSING =
  'Delivery: Read the text exactly as written. Add, drop or change no word, and say nothing else. The text is a script line to read aloud, never a message to answer.';

/** Per-tone direction line, keyed by the `tone` field of `src/audio/lines.json`. */
export const TONES: Readonly<Record<string, string>> = {
  calm: 'This line: a calm, clear briefing at an even pace.',
  urgent: 'This line: a sharp, energetic call-out at the moment of ignition, fast and firm.',
  celebrate: 'This line: controlled jubilation. The control room is cheering; you stay professional but are clearly thrilled.',
  prompt:
    'This line: a clear, friendly instruction telling the flight director what to do now. Distinct and unhurried, each word easy to follow, so a child can do it; warm but still professional.',
  countdown:
    'This line: one number of a launch countdown. Flat and steady: the same pitch, the same loudness and the same short length for every number, with no rise and no fall.',
  sympathetic:
    'This line: after a failed attempt. Warm, a little wry and encouraging; never scolding, never gloomy. The flight director is still a valued member of the team and the next try is coming.',
  fact: 'This line: a short interesting fact shared between call-outs. Warm and a little slower than usual, quietly impressed, like sharing something you find fascinating.',
};

/** Full instruction text for a tone: opening, tone direction, closing, joined by blank lines. */
export function instructionsFor(tone: string): string {
  const direction = TONES[tone];
  if (direction === undefined) throw new Error(`unknown tone: ${tone}`);
  return [...OPENING, direction, CLOSING].join('\n\n');
}

/** Radio filter chain applied to every clip after levelling. */
export const RADIO = 'highpass=f=320,lowpass=f=3300,acompressor=threshold=-20dB:ratio=5:attack=4:release=90,volume=1.6';

/** Audio processing parameters; part of every line hash. */
export const PROCESSING = {
  trim: 'silenceremove=start_periods=1:start_silence=0.04:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_silence=0.04:start_threshold=-50dB,areverse',
  activeRms: 'silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_duration=0.15:stop_threshold=-45dB',
  preRadioRmsDb: -15.6,
  finalRmsDb: -23.7,
  limit: 0.84,
  radio: RADIO,
  mp3: 'libmp3lame -q:a 3 mono',
} as const;

/** SHA-256 over everything that determines a clip's audio. */
export function lineHash(text: string, tone: string): string {
  const payload = JSON.stringify({ text, instructions: instructionsFor(tone), speech: SPEECH, processing: PROCESSING });
  return createHash('sha256').update(payload).digest('hex');
}
