import { STAGING } from '../tuning.ts';
import type { InputState, Stars } from '../types.ts';

/** Where the hot staging is. `count` includes the count's prompt before its first number; the last three are endings. */
export type StagingPhase = 'throttleDown' | 'count' | 'fire' | 'pullAway' | 'failed' | 'exploded' | 'complete';

/** Something that happened during one step. */
export type StagingEvent =
  | { kind: 'prompt' }
  | { kind: 'countPrompt' }
  | { kind: 'count'; n: number }
  | { kind: 'countStopped' }
  | { kind: 'separate'; error: number }
  | { kind: 'early' }
  | { kind: 'late' }
  | { kind: 'pullAway' }
  | { kind: 'weak' }
  | { kind: 'complete'; stars: Stars };

/** The whole state of a hot-staging run. */
export interface StagingState {
  phase: StagingPhase;
  /** Seconds since the throttle-down prompt was given. */
  promptT: number;
  /** Seconds the throttle has been down without a break. */
  downT: number;
  /** Seconds since the count's prompt. */
  countT: number;
  /** The count number showing, undefined outside the count. */
  digit: number | undefined;
  /** The flip time minus the moment of zero, set at separation. */
  error: number | undefined;
  /** Stars earned by the flip's timing. */
  timingStars: Stars;
  /** Seconds since the flip. */
  fireT: number;
  /** Seconds from the flip to reaching `fullThrottle`. */
  throttleT: number | undefined;
  /** Distance between the booster's top and the ship's base. */
  gap: number;
  /** Speed at which the gap grows once the ship pulls away. */
  gapSpeed: number;
  /** Seconds since the ship pulled away. */
  pullT: number;
  /** Stars awarded on completion. */
  stars: Stars;
}

/** Seconds from the count's prompt to the moment of zero. */
export const ZERO_AT = STAGING.countLead + STAGING.countFrom;

/** A fresh run with the stack climbing on all booster engines. */
export function createStaging(): StagingState {
  return {
    phase: 'throttleDown',
    promptT: Infinity,
    downT: 0,
    countT: 0,
    digit: undefined,
    error: undefined,
    timingStars: 0,
    fireT: 0,
    throttleT: undefined,
    gap: 0,
    gapSpeed: 0,
    pullT: 0,
    stars: 0,
  };
}

/** Stars for a flip `error` seconds from zero, inside the window. */
export function timingStarsOf(error: number): Stars {
  const e = Math.abs(error);
  if (e <= STAGING.threeStarError) return 3;
  if (e <= STAGING.twoStarError) return 2;
  return 1;
}

/** The gap before the ship pulls away: it rises to `hopHeight` and closes again at the throttle deadline. */
function hopOf(fireT: number): number {
  return STAGING.hopHeight * Math.sin((Math.PI * Math.min(fireT, STAGING.throttleDeadline)) / STAGING.throttleDeadline);
}

/**
 * Advances the run by `dt` seconds with input `input`; `flip` is true for the step the Arm switch was flipped in.
 * Returns what happened, in order. After completion the gap keeps growing.
 */
export function stepStaging(s: StagingState, dt: number, input: InputState, flip: boolean): StagingEvent[] {
  const events: StagingEvent[] = [];
  switch (s.phase) {
    case 'throttleDown':
      s.downT = input.throttle <= STAGING.throttleLow ? s.downT + dt : 0;
      if (s.promptT >= STAGING.promptRepeat) {
        s.promptT = 0;
        events.push({ kind: 'prompt' });
      } else s.promptT += dt;
      if (s.downT >= STAGING.throttleLowHold && s.promptT >= STAGING.promptSeconds) {
        s.phase = 'count';
        s.countT = 0;
        events.push({ kind: 'countPrompt' });
      }
      break;
    case 'count':
      stepCount(s, dt, input, flip, events);
      break;
    case 'fire':
      s.fireT += dt;
      if (input.throttle >= STAGING.fullThrottle) {
        s.throttleT = s.fireT;
        s.gapSpeed = Math.max(0, (hopOf(s.fireT) - s.gap) / dt);
        s.phase = 'pullAway';
        events.push({ kind: 'pullAway' });
      } else if (s.fireT >= STAGING.throttleDeadline) {
        s.gap = 0;
        s.phase = 'exploded';
        events.push({ kind: 'weak' });
        break;
      }
      s.gap = hopOf(s.fireT);
      break;
    case 'pullAway':
    case 'complete':
      s.pullT += dt;
      s.gapSpeed += STAGING.pullAccel * dt;
      s.gap += s.gapSpeed * dt;
      if (s.phase === 'pullAway' && s.pullT >= STAGING.pullSeconds) {
        const quick = (s.throttleT ?? Infinity) <= STAGING.quickThrottle;
        s.stars = quick ? s.timingStars : (Math.min(2, s.timingStars) as Stars);
        s.phase = 'complete';
        events.push({ kind: 'complete', stars: s.stars });
      }
      break;
    case 'failed':
    case 'exploded':
      break;
  }
  return events;
}

function stepCount(s: StagingState, dt: number, input: InputState, flip: boolean, events: StagingEvent[]): void {
  s.countT += dt;
  const error = s.countT - ZERO_AT;
  if (flip && s.countT >= STAGING.countLead) {
    s.digit = undefined;
    if (error < -STAGING.earlyLimit) {
      s.phase = 'exploded';
      events.push({ kind: 'early' });
      return;
    }
    s.error = error;
    s.timingStars = timingStarsOf(error);
    s.phase = 'fire';
    s.fireT = 0;
    events.push({ kind: 'separate', error });
    return;
  }
  if (input.throttle > STAGING.countThrottle) {
    s.digit = undefined;
    s.phase = 'throttleDown';
    s.promptT = Infinity;
    s.downT = 0;
    events.push({ kind: 'countStopped' });
    return;
  }
  if (error >= STAGING.lateLimit) {
    s.digit = undefined;
    s.phase = 'failed';
    events.push({ kind: 'late' });
    return;
  }
  if (s.countT < STAGING.countLead) return;
  const digit = Math.max(0, STAGING.countFrom - Math.floor(s.countT - STAGING.countLead));
  if (digit !== s.digit) {
    s.digit = digit;
    events.push({ kind: 'count', n: digit });
  }
}
