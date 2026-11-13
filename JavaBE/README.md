# 2D Game Canvas Template

The general-purpose template for building 2D mini-games and interactive applications with Aippy. Supports both **React DOM** rendering (grid/card/tap games) and **Canvas 2D** rendering (physics/platformer/runner games).

## Features

- **Canvas 2D game loop** — `useGameLoop` with delta-time, HiDPI scaling, and design-resolution scaling (400×600 expand mode)
- **React DOM rendering** — standard React state + CSS for grid-based and turn-based games
- **Image loading** — `useGameImages` preloads multiple images in parallel, returns `HTMLImageElement` instances
- **Drawing helpers** — `drawImageContain` (aspect-ratio-preserving contain), `drawBackground` (cover), `drawImageSafe` (exact rectangle, caller-controlled), `drawImageCentered` (square box)
- **Device integration** — audio, vibration, and leaderboard APIs via `@aippy/runtime`
- **Responsive design** — automatic adaptation from iPhone SE (375px) to iPad (744px) with proportional scaling

## Tech Stack

- **React 19** + **TypeScript** — type-safe UI framework
- **Canvas 2D API** — continuous-motion game rendering
- **Tailwind CSS** — utility-first styling for DOM games and overlays
- **@aippy/runtime** — device APIs (audio, vibrate, leaderboard)

## Use Cases

- **Canvas games**: Flappy Bird, Doodle Jump, endless runners, pong, breakout, drawing games
- **DOM games**: 2048, match-3, minesweeper, memory cards, whack-a-mole, quiz/trivia
- **Interactive tools**: creative apps, data visualizations, educational content
- **Social apps**: quiz, voting, personality tests

## Project Structure

```
src/
├── main.tsx                    # Application entry point
├── App.tsx                     # Root component, manages viewport dimensions
├── components/
│   └── CanvasDemo.tsx          # Paddle Ball demo — reference implementation for designWidth: 400
├── hooks/
│   ├── useGameLoop.ts          # Game loop: rAF + delta-time + HiDPI + design-resolution scaling
│   ├── useCanvasDPI.ts         # Low-level HiDPI canvas setup (used internally by useGameLoop)
│   ├── useGameImages.ts        # Parallel image preloader, returns { images, loaded, progress }
│   ├── useRefState.ts          # useRef wrapper with setState-like API
│   └── useSFX.ts               # Tone.js SFX synthesis via useAudioContext (stable callbacks)
├── utils/
│   └── drawHelpers.ts          # drawImageContain, drawImageSafe, drawImageCentered, drawBackground
├── index.css                   # Global styles + Tailwind
└── vite-env.d.ts               # Vite type definitions
```

## Key APIs

### `useGameLoop(options, update, draw, backgroundImage?)`

The core game loop hook. Returns `{ canvasRef, logicalWidth, logicalHeight, getLogicalCoords }`.

```tsx
const {
  canvasRef,
  logicalWidth: lw,
  logicalHeight: lh,
} = useGameLoop(
  { width, height },
  ({ width: w, height: h, deltaTime }) => {
    bird.vy += 800 * deltaTime;
    bird.y += bird.vy * deltaTime;
  },
  (ctx, { width: w, height: h }) => {
    drawImageContain(ctx, img, w / 2, bird.y, 40, 40);
  },
  images.bg
);
```

Design scaling (400×600) is automatic. Write `BIRD_SIZE = 40`, `GRAVITY = 800` directly — content scales proportionally on every device.

### `useGameImages(urlMap)`

Preloads images in parallel. Returns `{ images, loaded, progress }`.

```tsx
const { images, loaded } = useGameImages({
  bg: 'https://cdn.aippy.ai/asset/xxx.jpg',
  bird: 'https://cdn.aippy.ai/asset/yyy.png',
});
// Canvas: drawImageContain(ctx, images.bird, x, y, w, h)
// DOM: <img src={images.bird?.src} />
```

### Drawing Helpers (`@/utils/drawHelpers`)

| Helper                                           | Purpose                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `drawImageContain(ctx, img, cx, cy, boxW, boxH)` | Draw centered, aspect-ratio preserved (object-contain). **Use for all game elements** |
| `drawBackground(ctx, img, w, h)`                 | Full-canvas object-cover. Prefer `useGameLoop` 4th arg instead of calling directly    |
| `drawImageSafe(ctx, img, dx, dy, dw, dh)`        | 9-param drawImage wrapper, exact rectangle fill — does NOT preserve aspect ratio      |
| `drawImageCentered(ctx, img, cx, cy, size)`      | Draw centered in a square box — distorts non-square images                            |

## Development

```bash
pnpm install
pnpm run dev
```

## Build

```bash
pnpm run build
```

## License

Private
