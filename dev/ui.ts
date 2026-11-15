import { createInput } from '../src/input/index.ts';
import '../src/ui/styles.css';
import type { HintIcon, Sfx, SpeedLight, Stars, Voice } from '../src/types.ts';
import { showFactCard } from '../src/ui/factCard.ts';
import { createHud } from '../src/ui/hud.ts';
import { showNameEntry } from '../src/ui/nameEntry.ts';
import { showPatch } from '../src/ui/patch.ts';
import { showPicker } from '../src/ui/picker.ts';
import { showRetry } from '../src/ui/retry.ts';
import { showTitle } from '../src/ui/title.ts';

// Shows one screen or HUD state on its own (?view=title|name|fact|retry|patch|picker|hud&...).
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

const voice: Voice = {
  async load() {},
  async say(id) {
    console.log('voice', id);
  },
  async queue() {},
  stop() {},
  speaking: false,
};

function standInImage(color = '#e08a3c'): string {
  const c = document.createElement('canvas');
  c.width = 1536;
  c.height = 1024;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = color;
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
} else if (view === 'picker') {
  // &stages=7&best=3,2,-1 (best per stage, -1 never completed)&sel=liftoff&land=catch:2:deploy (id:stars:unlocks)
  const ids = ['liftoff', 'maxq', 'staging', 'catch', 'deploy', 'reentry', 'shipcatch'].slice(0, num('stages') ?? 7);
  const best = (params.get('best') ?? '').split(',').map((v) => (v === '' ? -1 : Number(v)));
  const colors = ['#e0a83c', '#3c8ae0', '#8a3ce0', '#3ce08a', '#e03c6a', '#a0e03c', '#3cc6e0', '#c63ce0'];
  const tiles = [
    { id: 'mission', image: standInImage(colors[0]), stars: undefined, locked: false },
    ...ids.map((id, i) => ({
      id,
      image: standInImage(colors[i + 1]),
      stars: Math.max(0, best[i] ?? -1) as Stars,
      locked: i > 0 && (best[i - 1] ?? -1) < 0,
    })),
  ];
  const [landId, landStars, unlocks] = (params.get('land') ?? '').split(':');
  const landing = landId ? { id: landId, stars: Number(landStars) as Stars, unlocks: unlocks || undefined } : undefined;
  const picker = showPicker(overlay, tiles, params.get('sel') ?? 'mission', landing, voice, sfx);
  void picker.chosen.then((id) => console.log('chosen', id));
  const input = createInput();
  let last = performance.now();
  const loop = (now: number): void => {
    input.poll();
    picker.update(Math.min(0.05, (now - last) / 1000), input);
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
} else if (view === 'hud') {
  const hud = createHud(overlay);
  hud.setThrottle(num('throttle'), num('band'), num('bandTo'));
  hud.setFuel(num('fuel'));
  hud.setHeat(num('heat'));
  hud.setPressure(num('pressure'), num('redFrom'));
  hud.setPips(num('pips'), num('total'));
  if (params.has('pipsTo')) setTimeout(() => hud.setPips(num('pipsTo'), num('total')), 600);
  hud.setSpeedLight((params.get('speed') ?? undefined) as SpeedLight | undefined);
  hud.setCountdown(num('count'));
  hud.setTilt(num('right'), num('away'), num('safe'), num('edge'));
  hud.setHint((params.get('hint') ?? undefined) as HintIcon | undefined);
}
