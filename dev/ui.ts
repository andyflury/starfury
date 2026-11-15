import '../src/ui/styles.css';
import type { HintIcon, Sfx, SpeedLight } from '../src/types.ts';
import { showFactCard } from '../src/ui/factCard.ts';
import { createHud } from '../src/ui/hud.ts';
import { showNameEntry } from '../src/ui/nameEntry.ts';
import { showPatch } from '../src/ui/patch.ts';
import { showRetry } from '../src/ui/retry.ts';
import { showTitle } from '../src/ui/title.ts';

// Shows one screen or HUD state on its own (?view=title|name|fact|retry|patch|hud&...).
const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'title';
const num = (key: string): number | undefined => (params.has(key) ? Number(params.get(key)) : undefined);

const scene = document.getElementById('scene');
const overlay = document.getElementById('overlay');
if (!scene || !overlay) throw new Error('harness markup missing');
scene.style.background = 'linear-gradient(180deg, #3d7fd0 0%, #9cc8f0 55%, #2a6fb0 56%, #d8b26a 70%)';

const sfx: Sfx = {
  setEngine() {},
  explosion() {},
  tick() {},
  clank() {},
  fail() {},
  success() {},
  star() {
    console.log('sfx.star');
  },
  stop() {},
};

function standInImage(): string {
  const c = document.createElement('canvas');
  c.width = 1536;
  c.height = 1024;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = '#e08a3c';
  ctx.fillRect(0, 0, c.width, c.height);
  return c.toDataURL();
}

if (view === 'title') {
  const t = showTitle(overlay);
  void t.pressed.then((choice) => {
    console.log('title', JSON.stringify(choice));
    t.launch();
  });
} else if (view === 'name') {
  const n = showNameEntry(overlay, params.get('name') ?? '');
  void n.done.then((name) => console.log('name', name));
} else if (view === 'fact') {
  showFactCard(overlay, standInImage()).speaking(true);
} else if (view === 'retry') {
  showRetry(overlay);
} else if (view === 'patch') {
  const p = showPatch(overlay, params.get('name') ?? 'MAX', num('stars') ?? 4, num('max') ?? 6, sfx);
  if (params.has('hint')) p.showHint();
  let last = performance.now();
  const loop = (now: number): void => {
    p.update(Math.min(0.05, (now - last) / 1000));
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
} else if (view === 'hud') {
  const hud = createHud(overlay);
  hud.setThrottle(num('throttle'), num('band'));
  hud.setFuel(num('fuel'));
  hud.setSpeedLight((params.get('speed') ?? undefined) as SpeedLight | undefined);
  hud.setCountdown(num('count'));
  hud.setTilt(num('tilt'), num('limit'));
  hud.setHint((params.get('hint') ?? undefined) as HintIcon | undefined);
}
