import type { Language, LineId, Voice } from '../types.ts';
import lines from './lines.json';

const DUCK_LEVEL = 0.25;
const DUCK_DOWN_SECONDS = 0.08;
const DUCK_UP_SECONDS = 0.25;

interface Entry {
  readonly id: LineId;
  readonly resolve: () => void;
  source?: AudioBufferSourceNode;
  timer?: ReturnType<typeof setTimeout>;
  done: boolean;
}

/** Voice-line playback on `ctx` into `out`; `duck` is the gain of the effects bus, lowered while a line plays. */
export function createVoice(ctx: BaseAudioContext, out: AudioNode, duck: AudioParam): Voice {
  let buffers = new Map<LineId, AudioBuffer>();
  let requested: Language | undefined;
  let loading = false;
  let complete = false;
  let latest: Promise<void> = Promise.resolve();
  const pending: Entry[] = [];
  let current: Entry | undefined;

  function rampDuck(level: number, seconds: number): void {
    const now = ctx.currentTime;
    duck.cancelScheduledValues(now);
    duck.setValueAtTime(duck.value, now);
    duck.linearRampToValueAtTime(level, now + seconds);
  }

  function finish(entry: Entry): void {
    if (entry.done) return;
    entry.done = true;
    clearTimeout(entry.timer);
    if (entry.source) {
      entry.source.onended = null;
      entry.source.stop();
      entry.source.disconnect();
    }
    entry.resolve();
    if (current === entry) {
      current = undefined;
      advance();
    }
  }

  function advance(): void {
    if (current) return;
    const entry = pending.shift();
    if (!entry) {
      rampDuck(1, DUCK_UP_SECONDS);
      return;
    }
    current = entry;
    const buffer = buffers.get(entry.id);
    if (!buffer) {
      entry.timer = setTimeout(() => finish(entry), 0);
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(out);
    source.onended = () => finish(entry);
    entry.source = source;
    rampDuck(DUCK_LEVEL, DUCK_DOWN_SECONDS);
    source.start();
  }

  function enqueue(id: LineId): Promise<void> {
    return new Promise((resolve) => {
      pending.push({ id, resolve, done: false });
      advance();
    });
  }

  function stop(): void {
    for (const entry of pending.splice(0)) entry.resolve();
    if (current) finish(current);
  }

  return {
    load(language) {
      if (language === requested && (loading || complete)) return latest;
      stop();
      requested = language;
      loading = true;
      complete = false;
      const fresh = new Map<LineId, AudioBuffer>();
      buffers = fresh;
      const ids = Object.keys(lines) as LineId[];
      const run = Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(`${import.meta.env.BASE_URL}voice/${language}/${id}.mp3`);
            if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('audio/')) throw new Error(`HTTP ${res.status}`);
            fresh.set(id, await ctx.decodeAudioData(await res.arrayBuffer()));
          } catch (error) {
            console.warn(`voice line ${language}/${id} not loaded: ${String(error)}`);
          }
        }),
      ).then(() => {
        if (buffers !== fresh) return latest;
        loading = false;
        complete = fresh.size === ids.length;
        return undefined;
      });
      latest = run as Promise<void>;
      return latest;
    },

    say(id) {
      stop();
      return enqueue(id);
    },

    queue: enqueue,

    stop,

    get speaking() {
      return current?.source !== undefined;
    },
  };
}
