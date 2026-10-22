import { installFakeCanvas } from './fakeCanvas.js';

// Some modules (e.g. sconce.js's shared `RAG` material) draw a procedural canvas texture once, eagerly,
// at module-import time rather than lazily inside a factory function. That means the fake 2D context
// must already be installed before a jsdom test file's first `import` is evaluated, which is earlier
// than any individual spec's `beforeEach` can run. Vitest runs `setupFiles` after the environment
// (jsdom, in this case) is prepared but before the test file's own module graph loads, so this is the
// one place that is early enough. Guarded so it's a no-op for specs running in the plain `node`
// environment, which have no `HTMLCanvasElement` global at all.
if (typeof HTMLCanvasElement !== 'undefined') {
  installFakeCanvas();
}
