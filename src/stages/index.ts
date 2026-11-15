import type { StageFactory } from '../types.ts';
import { createLiftoffStage as createLiftoff } from './liftoff.ts';
import { createTransition } from './transition.ts';
import { createBoosterCatch as createCatch } from './boosterCatch.ts';

/** One step of the mission: a stage, or the fact card shown between stages. */
export type MissionStep = { kind: 'stage'; id: string; create: StageFactory } | { kind: 'fact'; id: 'fact' };

/** The mission's steps in the order the app runs them. */
export const MISSION: readonly MissionStep[] = [
  { kind: 'stage', id: 'liftoff', create: createLiftoff },
  { kind: 'fact', id: 'fact' },
  { kind: 'stage', id: 'transition', create: createTransition },
  { kind: 'stage', id: 'catch', create: createCatch },
];
