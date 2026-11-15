# StarFury

A browser 3D rocket game for a child who cannot read yet, flown with a Radiomaster TX12 RC transmitter and guided by a German mission-controller voice. v1 has two stages, Liftoff and Booster Catch, with a fact card and a staging cutscene between them and a mission patch with stars at the end.

## Run

```
npm install
npm run dev
```

Open `http://localhost:5173` in Chrome. The title screen needs one key or pointer press, which also unlocks audio. It is not deployed anywhere.

## Controls

| | TX12 | Keyboard |
|---|---|---|
| Throttle | left stick, up and down | W and S |
| Steer | right stick | arrow keys |
| Arm, confirm, retry | Arm switch | Space (Arm), Enter or R (confirm) |
| Back to the title | | Escape |

The keyboard is used whenever no mapped controller is connected. The controller setup wizard runs on the first start with a controller connected; the top-left button on the title screen runs it again and the top-right button changes the name. Setting up the radio itself is described in `docs/tx12-setup.md`.

## Pages for checking and tuning

- `/?stage=liftoff`, `/?stage=transition`, `/?stage=catch` start the mission at that step.
- `/dev/input.html` shows what the controller sends, raw and mapped.
- `/dev/audio.html` is a soundboard of every voice line and sound effect.
- `/dev/world.html` is a free camera over the launch site with keys for engines, chopsticks and explosions.
- `/dev/ui.html`, `/dev/liftoff.html` and `/dev/catch.html` show single screens and step a stage to an exact moment.

Every tunable number of the two stages is in `src/tuning.ts`.

## Voice and illustrations

The voice lines are in `src/audio/lines.json`. `npm run voice` generates the MP3 of every new or changed line into `public/voice/de/` (OpenAI `gpt-4o-mini-tts`, voice `onyx`, radio filter baked in; settings in `scripts/voice-settings.ts`), and `npm run images` does the same for the fact illustrations in `public/img/` from `scripts/image-prompts.json`. Both need `OPENAI_KEY` or `OPENAI_API_KEY` in the environment and `ffmpeg` on the path, and make no API call when nothing changed.

## Build and test

`npm test` runs the simulation, input and voice-file tests. `npm run build` typechecks, runs the tests and writes the static site to `dist/`; it fails when a voice line has no current MP3.
