# StarFury

**Play it: <https://andyflury.github.io/starfury/>**

A browser 3D rocket game for a child who cannot read yet, flown with a Radiomaster TX12 RC transmitter and guided by a mission-controller voice in German or American English. The mission has seven stages in flight order (Liftoff, Max-Q ascent, Hot staging, Booster catch, Starlink deploy, Re-entry, Ship catch) with fact cards and a cutscene between them and a mission patch with stars at the end; a stage picker lets him play the whole mission or any stage he has reached.

## Run

```
npm install
npm run dev
```

Open `http://localhost:5173` in Chrome. The title screen needs one key or pointer press, which also unlocks audio. Every push to `main` builds the game and deploys it to GitHub Pages (`.github/workflows/pages.yml`).

## Controls

| | TX12 | Keyboard |
|---|---|---|
| Throttle | left stick, up and down | W and S |
| Steer, move the picker's highlight | right stick | arrow keys |
| Arm, confirm, retry | Arm switch | Space (Arm), Enter or R (confirm) |
| Back to the title | | Escape |

The keyboard is used whenever no mapped controller is connected. The controller setup wizard runs on the first start with a controller connected; the top-left button on the title screen runs it again, the top-right button changes the name, and the flag button at the bottom left switches the voice between German and English (it starts in the browser's language). Setting up the radio itself is described in `docs/tx12-setup.md`.

## Pages for checking and tuning

- `/?stage=<id>` starts the mission at that step, skipping the picker: `liftoff`, `maxq`, `staging`, `boostback`, `catch`, `deploy`, `reentry`, `shipcatch`.
- `/dev/input.html` shows what the controller sends, raw and mapped.
- `/dev/audio.html` is a soundboard of every voice line and sound effect.
- `/dev/world.html` is a free camera over the launch site with keys for engines, chopsticks and explosions.
- `/dev/ui.html` shows single screens and HUD states, and `/dev/liftoff.html`, `/dev/maxq.html`, `/dev/staging.html`, `/dev/catch.html`, `/dev/deploy.html` and `/dev/reentry.html` step a stage to an exact moment under a scripted pilot.

Every tunable number of the stages is in `src/tuning.ts`, one object per stage.

## Voice and illustrations

The voice lines are in `src/audio/lines.json`, each with its German and its English text. `npm run voice` generates the MP3 of every new or changed line into `public/voice/de/` and `public/voice/en/` (OpenAI `gpt-4o-mini-tts`, voice `onyx`, radio filter baked in; settings in `scripts/voice-settings.ts`), and `npm run images` does the same for the fact illustrations and the stage-picker tiles in `public/img/` from `scripts/image-prompts.json`. Both need `OPENAI_KEY` or `OPENAI_API_KEY` in the environment and `ffmpeg` on the path, and make no API call when nothing changed.

## Build and test

`npm test` runs the simulation, input and voice-file tests. `npm run build` typechecks, runs the tests and writes the static site to `dist/`; it fails when a voice line has no current MP3.
