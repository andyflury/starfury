import type { StageFactory } from '../types.ts';
import { createLiftoffStage as createLiftoff } from './liftoff.ts';
import { createMaxqStage as createMaxq } from './maxq.ts';
import { createStagingStage as createStaging } from './staging.ts';
import { createBoostback } from './boostback.ts';
import { createBoosterCatch as createCatch, createShipCatch } from './catch.ts';
import { createDeployStage as createDeploy } from './deploy.ts';
import { createReentryStage as createReentry } from './reentry.ts';

/**
 * One step of the mission: a scored `stage` that gets a picker tile, an unscored `cutscene`, or a `fact` card. Every
 * id is unique and names the step in `?stage=` and `window.starfury.step`.
 */
export type MissionStep =
  | { kind: 'stage'; id: string; create: StageFactory }
  | { kind: 'cutscene'; id: string; create: StageFactory }
  | { kind: 'fact'; id: string };

/** The mission's steps in flight order. */
export const MISSION: readonly MissionStep[] = [
  { kind: 'stage', id: 'liftoff', create: createLiftoff },
  { kind: 'stage', id: 'maxq', create: createMaxq },
  { kind: 'fact', id: 'fact1' },
  { kind: 'stage', id: 'staging', create: createStaging },
  { kind: 'cutscene', id: 'boostback', create: createBoostback },
  { kind: 'stage', id: 'catch', create: createCatch },
  { kind: 'fact', id: 'fact2' },
  { kind: 'stage', id: 'deploy', create: createDeploy },
  { kind: 'stage', id: 'reentry', create: createReentry },
  { kind: 'stage', id: 'shipcatch', create: createShipCatch },
];
