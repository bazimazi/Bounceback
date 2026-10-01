# Bounceback

A puzzle game about a bouncing ball and the ghosts of your previous attempts.

You steer. The ball bounces on its own. When you echo, that run becomes a ghost and plays back exactly what you did, while you control the next one. Plates, doors, ferries, ice, and springs only make sense once your past selves are working with you.

## Play

```bash
npm install
npm run dev
```

Then open the local address Vite prints. `npm test` runs a deterministic solve of every chamber.

## Visuals

The temporal observatory has nine chapter palettes, layered architecture, animated astrolabes, volumetric light shafts, and a mechanical aperture. The ball and its echoes leave energy ribbons; harder landings send ripples across the floor. Rendering interpolates between physics steps while recordings remain deterministic. Static architecture is cached, and decorative animation respects Reduced motion in Settings or your system preference.

## Verification

- `npm test` solves all 16 chambers and checks replay fidelity.
- `npm run build` creates the production bundle.
- `npx playwright install chromium`, then `npm run test:browser`, checks gameplay, echo recording, phone and landscape layouts, and rendering in every chamber with reduced motion and high contrast.

## Controls

- A / D or arrow keys steer. On a touch screen, hold the left or right side.
- S or Down, or the Drop button, falls through a grate.
- Space or F echoes, turning the current trace into a ghost.
- R discards the current trace and keeps earlier ghosts.
- Backspace restarts the chamber.
- Z erases the latest echo, and every echo recorded after it.
- Q changes playback speed. H opens hints. Esc pauses.

Ghosts are numbered and patterned, so they stay distinct without relying on color alone.
