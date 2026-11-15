import { NeutralToneMapping, PCFShadowMap, SRGBColorSpace } from 'three';
import type { Scene, WebGLRenderer } from 'three';
import type { Effects, World } from '../types.ts';
import { createEffectsImpl } from './effects.ts';
import { createBooster, createShip } from './rocket.ts';
import { MOUNT_RADIUS, createStarbase } from './starbase.ts';

/** Sets tone mapping, output colour space and shadows, and caps the pixel ratio at 1.5. */
export function configureRenderer(renderer: WebGLRenderer): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
}

/** Builds Starbase with the stacked rocket on the mount, adds it to the scene and sets the scene's sky, fog, sun and environment. */
export function createWorld(scene: Scene): World {
  const booster = createBooster();
  const ship = createShip();
  const base = createStarbase(scene, booster);
  const { root, tower, padPoint } = base;
  root.add(booster.object, ship.object);
  scene.add(root);

  const resetToPad = (): void => {
    for (const [v, y] of [
      [booster, 0],
      [ship, booster.height],
    ] as const) {
      v.object.position.set(padPoint.x, padPoint.y + y, padPoint.z);
      v.object.quaternion.identity();
      v.object.scale.setScalar(1);
      v.object.visible = true;
      v.setEnginesLit(0);
    }
    tower.setChopsticks(0);
  };
  resetToPad();

  return { root, tower, booster, ship, padPoint, mountRadius: MOUNT_RADIUS, resetToPad, update: base.update };
}

/** Builds the exhaust, pad steam, explosion and camera-shake effects and adds their meshes to the scene. */
export function createEffects(scene: Scene): Effects {
  return createEffectsImpl(scene);
}
