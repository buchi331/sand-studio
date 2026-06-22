# Water Aquarium Realism Handoff

## Current Goal

Make Sand Studio feel like a realistic glass aquarium sitting on the user's desk, as if the user is magically manipulating sand and water inside it.

The project started with water shader improvements, but the user found the result still too digital. The direction then shifted from "make the water alone realistic" to "make the whole scene read as a real aquarium in a real room."

## Current Preview URL

Use:

```text
http://localhost:5190/
```

Notes:

- `5173` and `5174` were serving a different app called "灰の塔".
- `5188` was used temporarily.
- The current working preview is `5190`.

## Important Files

- `src/render/WebGL2Renderer.ts`
- `src/render/Renderer.ts`
- `src/render/frame.ts`
- `src/render/frame.test.ts`
- `src/ui/App.tsx`
- `src/ui/styles.css`
- `public/room-aquarium-bg.png`

## What Has Been Implemented

### Water Shader Work

In `src/render/WebGL2Renderer.ts`, water rendering was repeatedly improved:

- Added elapsed time to rendering via `uTime`.
- Added depth-based water color.
- Added animated surface highlight.
- Added caustics.
- Added edge foam.
- Added pseudo beveling within water cells.
- Added falling-water streaks.
- Added metaball/screen-space-fluid-like blending using neighboring water cells.
- Moved water toward a separate final composite pass so water is drawn as a smoother film rather than just colored cells.

This helped, but the user still felt the water was far from realistic. The main visual limits were:

- Cell-grid stair stepping at the water surface.
- A dark/blue rectangular panel feeling.
- Water looking like a flat overlay instead of something inside glass.

### Render Time Plumbing

`Renderer.render` now accepts an optional elapsed time:

```ts
render(grid: GridView, elapsedSeconds?: number): void
```

Added:

- `src/render/frame.ts`
- `src/render/frame.test.ts`

Purpose:

- Pass `requestAnimationFrame` time into the renderer.
- Let water animation continue even while the simulation is paused.

### Background and Aquarium Direction

The first attempt used CSS-only room/water-tank styling. The user strongly disliked it because it looked like a fake panel over a background.

The current direction is:

- Generate a photorealistic background image that already contains a glass aquarium sitting on a wooden desk.
- Do not draw the aquarium body in CSS.
- Place the game canvas inside the photographed aquarium.
- Add only a subtle front-glass overlay on top of the canvas.

Current background asset:

```text
public/room-aquarium-bg.png
```

It was generated as a photorealistic bright bedroom/desk scene with an empty glass aquarium already placed on the desk.

## Current User Feedback

Latest user intent:

- The canvas still feels like it is in front of the aquarium.
- They want it to feel like the sand/water are inside the aquarium.
- Suggested fixes:
  - Make the game screen more transparent.
  - Align the bottom edge of the canvas with the bottom of the aquarium in the image.

Current CSS has been adjusted in that direction, but it probably still needs more tuning against screenshots.

## Current CSS State To Inspect

Main selectors in `src/ui/styles.css`:

```css
.stage {
  align-items: flex-end;
  padding: 0 4px clamp(112px, 18vh, 168px);
}

.tank-shell {
  width: min(61vw, 552px);
  height: min(58vh, 612px);
  max-height: calc(100vh - 286px);
  aspect-ratio: 0.73;
}

.stage__canvas {
  opacity: 0.52;
  mix-blend-mode: multiply;
  filter: saturate(1.16) contrast(0.9) brightness(1.08);
}

.tank-front-glass {
  inset: -2px -1px 0;
  mix-blend-mode: screen;
}
```

These values are not final. They were rough adjustments to move the canvas down and make it more transparent.

## Recommended Next Steps

### 1. Precisely Align The Canvas To The Photo Aquarium

Use a screenshot and tune these values:

- `.tank-shell` width
- `.tank-shell` height
- `.tank-shell` aspect-ratio
- `.stage` bottom padding

The target is:

- Canvas bottom aligns with the inner bottom of the photographed aquarium.
- Canvas left/right edges sit inside the photographed front glass.
- Canvas top does not cover the real top rim.

### 2. Reduce The Dark Rectangle

The current canvas still risks looking like a translucent dark rectangle.

Try:

```css
opacity: 0.4;
mix-blend-mode: soft-light;
```

or:

```css
opacity: 0.55;
mix-blend-mode: overlay;
```

Also inspect `WebGL2Renderer.ts` empty-cell colors. If empty cells are too dark, they create the panel effect regardless of CSS transparency.

### 3. Use The Photo Aquarium Edges, Not CSS Edges

Earlier CSS 3D tank parts were removed/hidden because they looked fake. Keep it that way unless absolutely needed.

The photo already has:

- Glass side walls.
- Top rim.
- Bottom rim.
- Contact shadow.

CSS should only:

- Place the canvas.
- Add a very subtle front-glass sheen over the canvas.

### 4. Move UI If It Breaks Contact With The Desk

The palette and toolbar can cover the aquarium base and ruin the "standing on desk" illusion.

If needed:

- Move controls lower.
- Make controls more transparent.
- Collapse controls.
- Let the aquarium base remain visible.

## Commands For Verification

Use PowerShell with `npm.cmd`, not `npm`, because PowerShell may block `npm.ps1`.

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Recent verification status:

- Typecheck passed.
- Tests passed: 25 tests.
- Build passed.

## Dev Server Notes

If the local server is not running, start Vite on port `5190`.

```powershell
node node_modules\vite\bin\vite.js --host localhost --port 5190 --strictPort
```

In this environment, background startup sometimes failed without escalation, but an interactive/direct run works.

## Key Lesson

The most important design lesson from the user's feedback:

> Do not make a fake aquarium with CSS and put it on top of a background. The aquarium must be part of the realistic image, and the game canvas must be placed into that aquarium.

